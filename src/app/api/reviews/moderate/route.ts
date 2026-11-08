import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveAuthorizedRestaurant } from "@/lib/auth/identity";
import { replyToReview, setReviewHidden } from "@/lib/services/reviews";

/**
 * Owner-side review management: reply, hide, unhide.
 *
 * Hiding never deletes. The row, its scores and its text stay in the table so
 * the rating story cannot be rewritten by moderation; only visibility changes,
 * and `hidden_by`/`hidden_reason` record who decided and why.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Your session has expired." }, { status: 401 });

  let body: {
    reviewId?: string;
    restaurantId?: string;
    action?: "reply" | "hide" | "unhide";
    body?: string;
    reason?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  if (!body.reviewId || !body.action) {
    return NextResponse.json({ ok: false, error: "Unknown review." }, { status: 400 });
  }

  const restaurantId = await resolveAuthorizedRestaurant(user, body.restaurantId ?? null);
  if (!restaurantId) {
    return NextResponse.json({ ok: false, error: "You do not have access to that restaurant." }, { status: 403 });
  }

  const result =
    body.action === "reply"
      ? await replyToReview(user, body.reviewId, body.body ?? "")
      : await setReviewHidden(user, body.reviewId, body.action === "hide", body.reason ?? null);

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
