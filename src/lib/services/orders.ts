import { asAuthed, type AppUser, type TenantRole } from "@/lib/auth/server";
import { withSession } from "@/lib/db";
import { ANON, type Queryable } from "@/lib/db/types";
import { isUuid } from "@/lib/validation";

/* ==========================================================================
   Order service.
   Reads go through RLS as the signed-in user. Writes that change lifecycle
   state only ever call `transition_order()`, so the state machine and role
   checks live in one place and cannot be bypassed by a crafted request.
   ========================================================================== */

export const ORDER_STATUSES = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "served",
  "rejected",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["accepted", "rejected"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["served", "cancelled"],
  served: [],
  rejected: [],
  cancelled: [],
};

/** Which roles may perform each transition — mirrored and enforced in SQL. */
export const TRANSITION_ROLES: Partial<Record<OrderStatus, TenantRole[]>> = {
  accepted: ["owner", "manager"],
  rejected: ["owner", "manager"],
  preparing: ["owner", "manager", "kitchen"],
  ready: ["owner", "manager", "kitchen"],
  served: ["owner", "manager", "kitchen", "waiter"],
  cancelled: ["owner", "manager"],
};

export interface OrderSummary {
  id: string;
  order_number: string;
  status: OrderStatus;
  total: string;
  subtotal: string;
  tax_amount: string;
  service_charge: string;
  currency: string;
  item_count: number;
  customer_name: string | null;
  customer_phone: string | null;
  table_label: string | null;
  note: string | null;
  created_at: string;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  payment_status: string;
}

export interface OrderLine {
  id: string;
  name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  note: string | null;
}

export interface OrderDetail extends OrderSummary {
  items: OrderLine[];
  history: { to_status: string; from_status: string | null; created_at: string; actor_role: string | null }[];
}

export interface OrderFilters {
  status?: OrderStatus | "all" | "active";
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const SUMMARY_COLUMNS = `
  o.id, o.order_number, o.status, o.total, o.subtotal, o.tax_amount, o.service_charge,
  o.currency, o.item_count, o.customer_name, o.customer_phone, o.note,
  d.label as table_label, o.created_at, o.accepted_at, o.preparing_at, o.ready_at,
  o.served_at, o.rejected_at, o.rejection_reason, o.payment_status`;

export async function listOrders(
  user: AppUser,
  restaurantId: string,
  filters: OrderFilters = {},
): Promise<{ orders: OrderSummary[]; total: number }> {
  return asAuthed(user, async (tx) => {
    const params: unknown[] = [restaurantId];
    const where: string[] = ["o.restaurant_id = $1"];

    if (filters.status && filters.status !== "all") {
      if (filters.status === "active") {
        where.push("o.status in ('pending','accepted','preparing','ready')");
      } else {
        params.push(filters.status);
        where.push(`o.status = $${params.length}`);
      }
    }
    if (filters.search && filters.search.trim()) {
      params.push(`%${filters.search.trim()}%`);
      where.push(`(o.order_number ilike $${params.length}
        or coalesce(o.customer_name,'') ilike $${params.length}
        or coalesce(o.customer_phone,'') ilike $${params.length}
        or coalesce(d.label,'') ilike $${params.length})`);
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`o.created_at >= $${params.length}::timestamptz`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`o.created_at < ($${params.length}::date + 1)`);
    }

    const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
    const offset = Math.max(filters.offset ?? 0, 0);
    params.push(limit, offset);

    const rows = await tx.query<OrderSummary>(
      `select ${SUMMARY_COLUMNS}
         from orders o
         left join dining_tables d on d.id = o.table_id
        where ${where.join(" and ")}
        order by o.created_at desc
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );

    const countParams = params.slice(0, -2);
    const countRes = await tx.query<{ count: string }>(
      `select count(*)::text as count from orders o left join dining_tables d on d.id = o.table_id
        where ${where.join(" and ")}`,
      countParams,
    );

    return { orders: rows.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  });
}

export async function getOrder(
  user: AppUser,
  restaurantId: string,
  orderId: string,
): Promise<OrderDetail | null> {
  if (!isUuid(orderId)) return null;
  return asAuthed(user, async (tx) => {
    const res = await tx.query<OrderSummary>(
      `select ${SUMMARY_COLUMNS}
         from orders o
         left join dining_tables d on d.id = o.table_id
        where o.id = $1 and o.restaurant_id = $2`,
      [orderId, restaurantId],
    );
    const order = res.rows[0];
    if (!order) return null;

    const items = await tx.query<OrderLine>(
      `select id, name_snapshot as name, quantity, unit_price, line_total, note
         from order_items where order_id = $1 order by sort_order`,
      [orderId],
    );
    const history = await tx.query<{ to_status: string; from_status: string | null; created_at: string; actor_role: string | null }>(
      `select to_status, from_status, created_at, actor_role
         from order_status_history where order_id = $1 order by created_at`,
      [orderId],
    );
    return { ...order, items: items.rows, history: history.rows };
  });
}

export interface TransitionResult {
  ok: boolean;
  error?: string;
  status?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  "MP:FORBIDDEN": "You do not have access to this order.",
  "MP:FORBIDDEN_TRANSITION": "Your role cannot perform that action.",
  "MP:ORDER_NOT_FOUND": "This order no longer exists.",
  "MP:NOT_AUTHENTICATED": "Your session has expired. Sign in again.",
  "MP:INVALID_RANGE": "That date range is not valid.",
  "MP:IMMUTABLE_ORDER_FIELD": "Prices on a placed order cannot be edited.",
};

/**
 * Maps a database `MP:*` error to copy a restaurant worker can act on.
 *
 * The database raises coded errors with a `:detail` suffix (for example
 * `MP:INVALID_TRANSITION:pending->served`). Anything unrecognised must never
 * leak the code itself into the UI.
 */
export function friendlyTransitionError(message: string): string {
  const parts = message.split(":");
  const key = parts.slice(0, 2).join(":");
  if (ERROR_MESSAGES[key]) return ERROR_MESSAGES[key]!;
  if (parts[0] === "MP" && parts[1] === "INVALID_TRANSITION") {
    const [from, to] = (parts[2] ?? "").split("->");
    if (from && to) return `An order that is already ${from} cannot move to ${to}.`;
    return "That status change is not allowed from where the order is now.";
  }
  return "That change could not be applied.";
}

export async function transitionOrder(
  user: AppUser,
  orderId: string,
  next: OrderStatus,
  reason?: string,
): Promise<TransitionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Unknown order." };
  if (!ORDER_STATUSES.includes(next)) return { ok: false, error: "Unknown status." };

  try {
    return await asAuthed(user, async (tx) => {
      const res = await tx.query<{ result: { status: string } }>(
        "select public.transition_order($1, $2, $3) as result",
        [orderId, next, reason ?? null],
      );
      return { ok: true, status: res.rows[0]?.result.status };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, error: friendlyTransitionError(message) };
  }
}

export async function markPaymentStatus(
  user: AppUser,
  restaurantId: string,
  orderId: string,
  paymentStatus: "unpaid" | "paid",
): Promise<TransitionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Unknown order." };
  return asAuthed(user, async (tx) => {
    const res = await tx.query(
      "update orders set payment_status = $3 where id = $1 and restaurant_id = $2",
      [orderId, restaurantId, paymentStatus],
    );
    if (res.rowCount === 0) return { ok: false, error: "Order not found." };
    return { ok: true };
  });
}

export async function updateOrderNote(
  user: AppUser,
  restaurantId: string,
  orderId: string,
  note: string,
): Promise<TransitionResult> {
  if (!isUuid(orderId)) return { ok: false, error: "Unknown order." };
  return asAuthed(user, async (tx) => {
    await tx.query("update orders set note = $3 where id = $1 and restaurant_id = $2", [
      orderId,
      restaurantId,
      note.trim().slice(0, 500) || null,
    ]);
    return { ok: true };
  });
}

/* ---------------------------- Kitchen display ----------------------------- */

export interface KitchenTicket {
  id: string;
  order_number: string;
  status: "accepted" | "preparing" | "ready";
  table_label: string | null;
  created_at: string;
  accepted_at: string;
  preparing_at: string | null;
  ready_at: string | null;
  note: string | null;
  customer_name: string | null;
  item_count: number;
  items: { id: string; name: string; quantity: number; note: string | null }[];
}

export async function getKitchenFeed(user: AppUser, restaurantId: string): Promise<KitchenTicket[]> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ tickets: KitchenTicket[] }>(
      "select public.kitchen_feed($1) as tickets",
      [restaurantId],
    );
    return res.rows[0]?.tickets ?? [];
  });
}

/* -------------------------- Customer-side reads --------------------------- */

export interface PublicMenu {
  table: { id: string; label: string; zone: string | null } | null;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    tagline: string | null;
    description: string | null;
    logo_path: string | null;
    cover_path: string | null;
    currency: string;
    time_zone: string;
    phone: string | null;
    address: string | null;
    city: string | null;
  };
  settings: {
    tax_rate: string | number;
    tax_label: string;
    service_charge_rate: string | number;
    service_charge_label: string;
    prices_include_tax: boolean;
    accept_orders: boolean;
    require_customer_name: boolean;
  };
  categories: { id: string; name: string; description: string | null; sort_order: number }[];
  items: {
    id: string;
    category_id: string;
    name: string;
    slug: string;
    description: string | null;
    price: string;
    image_path: string | null;
    is_available: boolean;
    is_featured: boolean;
    sort_order: number;
    prep_minutes: number;
  }[];
}

export async function getMenuForQrToken(token: string): Promise<PublicMenu | null> {
  if (!token || token.length < 16) return null;
  const res = await withSession(ANON, (tx: Queryable) =>
    tx.query<{ menu: PublicMenu | null }>("select public.menu_for_qr($1) as menu", [token]),
  );
  return res.rows[0]?.menu ?? null;
}

export async function getMenuBySlug(slug: string): Promise<PublicMenu | null> {
  const res = await withSession(ANON, (tx: Queryable) =>
    tx.query<{ menu: PublicMenu | null }>("select public.menu_by_slug($1) as menu", [slug]),
  );
  return res.rows[0]?.menu ?? null;
}

export interface TrackedOrder {
  order_number: string;
  status: OrderStatus;
  payment_status: string;
  placed_at: string;
  updated_at: string;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  subtotal: string;
  tax_amount: string;
  service_charge: string;
  total: string;
  currency: string;
  note: string | null;
  customer_name: string | null;
  table_label: string | null;
  restaurant: { name: string; slug: string; phone: string | null; logo_path: string | null };
  items: { name: string; quantity: number; unit_price: string; line_total: string; note: string | null }[];
}

export async function getTrackedOrder(token: string): Promise<TrackedOrder | null> {
  if (!token || token.length < 16) return null;
  const res = await withSession(ANON, (tx: Queryable) =>
    tx.query<{ order: TrackedOrder | null }>("select public.get_order_tracking($1) as order", [token]),
  );
  return res.rows[0]?.order ?? null;
}

export interface CreateOrderLine {
  menu_item_id: string;
  quantity: number;
  note?: string | null;
}

export interface CreateOrderResult {
  ok: boolean;
  error?: string;
  order?: {
    order_id: string;
    order_number: string;
    tracking_token: string | null;
    status: OrderStatus;
    subtotal: string;
    tax_amount: string;
    service_charge: string;
    total: string;
    currency: string;
    item_count: number;
    table_label: string;
    created_at: string;
    idempotent_replay: boolean;
  };
}

const CUSTOMER_ERRORS: Record<string, string> = {
  "MP:INVALID_QR": "This QR code is no longer valid. Please ask a member of staff for a new one.",
  "MP:EMPTY_CART": "Your cart is empty.",
  "MP:CART_TOO_LARGE": "That is too many items for one order. Please split it.",
  "MP:DUPLICATE_ITEM": "The same dish appears twice. Adjust the quantity instead.",
  "MP:RESTAURANT_UNAVAILABLE": "This restaurant is not accepting orders right now.",
  "MP:TABLE_INACTIVE": "This table is not available for ordering. Please ask our staff.",
  "MP:ORDERING_DISABLED": "The restaurant has paused ordering for a moment. Please try again shortly.",
  "MP:INVALID_ITEM": "One of the dishes could not be recognised. Please refresh the menu.",
};

function friendlyCustomerError(message: string): string {
  const key = message.split(":").slice(0, 2).join(":");
  if (CUSTOMER_ERRORS[key]) return CUSTOMER_ERRORS[key]!;
  if (message.startsWith("MP:ITEM_UNAVAILABLE")) {
    return "One of the dishes in your cart just became unavailable. Please review your cart.";
  }
  return "We could not place your order. Please try again.";
}

export async function createOrder(input: {
  qrToken: string;
  items: CreateOrderLine[];
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
}): Promise<CreateOrderResult> {
  const sanitized = (input.items ?? [])
    .filter((line) => typeof line.menu_item_id === "string" && isUuid(line.menu_item_id))
    .slice(0, 50)
    .map((line) => ({
      menu_item_id: line.menu_item_id,
      quantity: Math.min(99, Math.max(1, Number(line.quantity) || 1)),
      note: typeof line.note === "string" ? line.note.slice(0, 200) : null,
    }));

  if (sanitized.length === 0) return { ok: false, error: "Your cart is empty." };
  if (sanitized.length !== input.items.length) {
    return { ok: false, error: "Some items in your cart were invalid. Please refresh the menu." };
  }
  const name = (input.customerName ?? "").trim().slice(0, 80);
  const phone = (input.customerPhone ?? "").trim().slice(0, 24);
  const note = (input.note ?? "").trim().slice(0, 300);
  if (phone && !/^[+()\-\s0-9]{6,24}$/.test(phone)) {
    return { ok: false, error: "Enter a valid phone number, or leave it blank." };
  }

  try {
    const res = await withSession(ANON, (tx) =>
      tx.query<{ result: CreateOrderResult["order"] }>(
        "select public.create_order($1, $2::jsonb, $3, $4, $5, $6) as result",
        [
          input.qrToken,
          JSON.stringify(sanitized),
          name || null,
          phone || null,
          note || null,
          input.idempotencyKey?.slice(0, 80) || null,
        ],
      ),
    );
    const order = res.rows[0]?.result;
    if (!order) return { ok: false, error: "We could not place your order. Please try again." };
    return { ok: true, order };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, error: friendlyCustomerError(message) };
  }
}
