import { asAuthed, type AppUser } from "@/lib/auth/server";
import { withSession } from "@/lib/db";
import { ANON } from "@/lib/db/types";
import { isUuid } from "@/lib/validation";

/* ==========================================================================
   Reviews, service requests, ETA and item prep.

   The split here matters:

   * Guests are `anon` and have no session, so everything they may do is a
     SECURITY DEFINER function that takes their tracking token and proves
     ownership inside the database (`submit_review`, `request_service`).
   * Staff are `authenticated` and go through RLS plus functions that re-check
     membership and role (`set_order_eta`, `service_board`, ...).

   Nothing in this file accepts a price, a restaurant id or a role from the
   browser as authoritative.
   ========================================================================== */

export type ReviewKind = "item" | "restaurant";
export type ServiceKind = "waiter" | "water" | "plate" | "bill" | "other";
export type ServiceStatus = "pending" | "acknowledged" | "completed" | "cancelled";

const ERROR_MESSAGES: Record<string, string> = {
  "MP:INVALID_TRACKING": "This link is not valid any more. Scan the QR code on your table again.",
  "MP:INVALID_REVIEW_KIND": "That review type is not supported.",
  "MP:INVALID_RATING": "Choose a rating from 1 to 5 stars.",
  "MP:REVIEW_TOO_LONG": "That review is too long — please keep it under 2000 characters.",
  "MP:REVIEW_DUPLICATE_ITEM": "You have already reviewed this dish.",
  "MP:REVIEW_DUPLICATE_RESTAURANT": "You have already reviewed this visit.",
  "MP:ITEM_NOT_ON_ORDER": "That dish was not part of this order.",
  "MP:REVIEW_NOT_ELIGIBLE": "Reviews open once your order has been served.",
  "MP:INVALID_ETA": "Choose a preparation time between 1 and 240 minutes.",
  "MP:FORBIDDEN": "Your role cannot do that.",
  "MP:ETA_NOT_ALLOWED": "A preparation time can only be set once the order is accepted.",
  "MP:FORBIDDEN_ETA": "Your role cannot set a preparation time.",
  "MP:INVALID_REQUEST_KIND": "That request type is not supported.",
  "MP:REQUEST_ALREADY_OPEN": "You already have an open request like this — a member of staff is on the way.",
  "MP:ORDER_CLOSED": "This order is closed, so requests cannot be raised on it.",
  "MP:REQUEST_NOT_FOUND": "That request no longer exists.",
  "MP:REQUEST_CLOSED": "That request is already finished.",
  "MP:INVALID_REPLY": "Write a reply between 1 and 1000 characters.",
  "MP:REVIEW_NOT_FOUND": "That review no longer exists.",
  "MP:INVALID_STATUS": "That status is not valid.",
  "MP:PREP_NOT_ALLOWED": "Lines can only be marked once the order has been accepted.",
  "MP:OUT_OF_RANGE": "That value is out of range.",
};

/** Turns an `MP:CODE:detail` database error into something a person can read. */
export function friendlyReviewError(message: string): string {
  const [scope, code] = message.split(":");
  const key = `${scope}:${code}`;
  if (ERROR_MESSAGES[key]) return ERROR_MESSAGES[key]!;
  if (key === "MP:REVIEW_NOT_ELIGIBLE") return "Reviews open once your order has been served.";
  return "That could not be saved. Please try again.";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------ Guest: reviews ---------------------------- */

export interface SubmitReviewInput {
  token: string;
  kind: ReviewKind;
  rating: number;
  menuItemId?: string | null;
  comment?: string | null;
  taste?: number | null;
  quality?: number | null;
  presentation?: number | null;
  service?: number | null;
  staff?: number | null;
  cleanliness?: number | null;
  photoPath?: string | null;
}

export async function submitReview(
  input: SubmitReviewInput,
): Promise<{ ok: true; id: string; orderNumber: string } | { ok: false; error: string }> {
  if (!input.token || input.token.length < 16) return { ok: false, error: ERROR_MESSAGES["MP:INVALID_TRACKING"]! };
  if (input.kind === "item" && (!input.menuItemId || !isUuid(input.menuItemId))) {
    return { ok: false, error: "That dish could not be identified." };
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: ERROR_MESSAGES["MP:INVALID_RATING"]! };
  }

  const score = (value: number | null | undefined) =>
    Number.isInteger(value) && value! >= 1 && value! <= 5 ? value! : null;

  try {
    return await withSession(ANON, async (tx) => {
      const res = await tx.query<{ result: { id: string; order_number: string } }>(
        "select public.submit_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result",
        [
          input.token,
          input.kind,
          input.kind === "item" ? input.menuItemId : null,
          input.rating,
          input.comment?.trim() || null,
          score(input.taste),
          score(input.quality),
          score(input.presentation),
          score(input.service),
          score(input.staff),
          score(input.cleanliness),
          input.photoPath || null,
        ],
      );
      const row = res.rows[0]!.result;
      return { ok: true as const, id: row.id, orderNumber: row.order_number };
    });
  } catch (error) {
    return { ok: false, error: friendlyReviewError(message(error)) };
  }
}

/* --------------------------- Guest: service requests ---------------------- */

export async function requestService(
  token: string,
  kind: ServiceKind,
  body?: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!token || token.length < 16) return { ok: false, error: ERROR_MESSAGES["MP:INVALID_TRACKING"]! };
  try {
    return await withSession(ANON, async (tx) => {
      const res = await tx.query<{ result: { id: string } }>(
        "select public.request_service($1,$2,$3) as result",
        [token, kind, body?.trim() || null],
      );
      return { ok: true as const, id: res.rows[0]!.result.id };
    });
  } catch (error) {
    return { ok: false, error: friendlyReviewError(message(error)) };
  }
}

/* -------------------------------- Staff: ETA ------------------------------ */

export async function setOrderEta(
  user: AppUser,
  orderId: string,
  minutes: number,
): Promise<{ ok: true; etaMinutes: number } | { ok: false; error: string }> {
  if (!isUuid(orderId)) return { ok: false, error: "Unknown order." };
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
    return { ok: false, error: ERROR_MESSAGES["MP:INVALID_ETA"]! };
  }
  try {
    return await asAuthed(user, async (tx) => {
      const res = await tx.query<{ result: { eta_minutes: number } }>(
        "select public.set_order_eta($1,$2) as result",
        [orderId, minutes],
      );
      return { ok: true as const, etaMinutes: res.rows[0]!.result.eta_minutes };
    });
  } catch (error) {
    return { ok: false, error: friendlyReviewError(message(error)) };
  }
}

/* ---------------------------- Staff: item prep ---------------------------- */

export async function setItemPrep(
  user: AppUser,
  itemId: string,
  status: "queued" | "preparing" | "done",
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(itemId)) return { ok: false, error: "Unknown line." };
  try {
    await asAuthed(user, async (tx) => {
      await tx.query("select public.set_item_prep($1,$2)", [itemId, status]);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyReviewError(message(error)) };
  }
}

/* -------------------------- Staff: review tools --------------------------- */

export interface ReviewRow {
  id: string;
  kind: ReviewKind;
  rating: number;
  comment: string | null;
  item_name: string | null;
  order_number: string;
  table_label: string | null;
  guest_name: string | null;
  is_hidden: boolean;
  hidden_reason: string | null;
  created_at: string;
  scores: Record<string, number>;
  reply: string | null;
  reply_at: string | null;
}

export interface ReviewSummary {
  restaurant: {
    average: number;
    count: number;
    service: number;
    staff: number;
    cleanliness: number;
    five_star: number;
    low_star: number;
  };
  items: { menu_item_id: string; name: string; average: number; count: number }[];
  recent: ReviewRow[];
}

export async function getReviews(user: AppUser, restaurantId: string): Promise<ReviewSummary | null> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ result: ReviewSummary }>(
      "select public.restaurant_reviews($1) as result",
      [restaurantId],
    );
    return res.rows[0]?.result ?? null;
  });
}

export async function replyToReview(
  user: AppUser,
  reviewId: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(reviewId)) return { ok: false, error: "Unknown review." };
  if (!body.trim()) return { ok: false, error: ERROR_MESSAGES["MP:INVALID_REPLY"]! };
  try {
    await asAuthed(user, async (tx) => {
      await tx.query("select public.reply_to_review($1,$2)", [reviewId, body]);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyReviewError(message(error)) };
  }
}

export async function setReviewHidden(
  user: AppUser,
  reviewId: string,
  hidden: boolean,
  reason?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(reviewId)) return { ok: false, error: "Unknown review." };
  try {
    await asAuthed(user, async (tx) => {
      await tx.query("select public.set_review_hidden($1,$2,$3)", [reviewId, hidden, reason ?? null]);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyReviewError(message(error)) };
  }
}

/* ------------------------- Staff: service board --------------------------- */

export interface ServiceRequestRow {
  id: string;
  kind: ServiceKind;
  body: string | null;
  status: ServiceStatus;
  table_label: string | null;
  order_number: string | null;
  created_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
}

export async function getServiceBoard(user: AppUser, restaurantId: string): Promise<ServiceRequestRow[]> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ board: ServiceRequestRow[] }>(
      "select public.service_board($1) as board",
      [restaurantId],
    );
    return res.rows[0]?.board ?? [];
  });
}

export async function setServiceStatus(
  user: AppUser,
  requestId: string,
  status: "acknowledged" | "completed" | "cancelled",
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuid(requestId)) return { ok: false, error: "Unknown request." };
  try {
    await asAuthed(user, async (tx) => {
      await tx.query("select public.set_service_status($1,$2)", [requestId, status]);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyReviewError(message(error)) };
  }
}

/* ----------------------------- ETA arithmetic ----------------------------- */

/**
 * Where the estimate stands, from the guest's point of view.
 *
 * `dueAt` is derived from when the kitchen actually started, so an order that
 * sat accepted for ten minutes does not get its estimate silently shortened.
 * This never changes the order's status — an overrun is a message, not a state.
 */
export function etaState(order: {
  status: string;
  eta_minutes: number | null;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
}): {
  minutes: number | null;
  dueAt: string | null;
  startedAt: string | null;
  overdueMinutes: number;
  overdue: boolean;
  remainingMinutes: number | null;
  progress: number;
  waitingForConfirmation: boolean;
} {
  const minutes = order.eta_minutes ?? null;
  const startedAt = order.preparing_at ?? order.accepted_at ?? null;
  const waitingForConfirmation = minutes === null;

  if (minutes === null || !startedAt) {
    return {
      minutes,
      dueAt: null,
      startedAt,
      overdueMinutes: 0,
      overdue: false,
      remainingMinutes: null,
      progress: 0,
      waitingForConfirmation: true,
    };
  }

  const base = new Date(startedAt).getTime();
  const dueAt = base + minutes * 60_000;
  const reference = order.ready_at ? new Date(order.ready_at).getTime() : Date.now();
  const elapsed = reference - base;
  const overdueMinutes = Math.max(0, Math.ceil((reference - dueAt) / 60_000));
  const isFinished = order.status === "ready" || order.status === "served";

  return {
    minutes,
    dueAt: new Date(dueAt).toISOString(),
    startedAt,
    overdueMinutes: isFinished ? 0 : overdueMinutes,
    overdue: !isFinished && overdueMinutes > 0,
    remainingMinutes: isFinished ? 0 : Math.max(0, Math.ceil((dueAt - reference) / 60_000)),
    progress: Math.max(0, Math.min(1, elapsed / (minutes * 60_000))),
    waitingForConfirmation: false,
  };
}
