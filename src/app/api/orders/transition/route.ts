import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveAuthorizedRestaurant } from "@/lib/auth/identity";
import { transitionOrder, ORDER_STATUSES, type OrderStatus } from "@/lib/services/orders";

/**
 * Lifecycle mutations from the dashboard/kitchen UI.
 *
 * The caller may only name one of their own restaurants; the transition itself is
 * authorized again inside the database function (role + state machine).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Your session has expired." }, { status: 401 });

  let body: { orderId?: string; next?: string; restaurantId?: string; reason?: string; etaMinutes?: number | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  if (!body.orderId || !body.next || !ORDER_STATUSES.includes(body.next as OrderStatus)) {
    return NextResponse.json({ ok: false, error: "Unknown order or status." }, { status: 400 });
  }

  const restaurantId = await resolveAuthorizedRestaurant(user, body.restaurantId ?? null);
  if (!restaurantId) return NextResponse.json({ ok: false, error: "You do not have access to that restaurant." }, { status: 403 });

  // The estimate is accepted with the order, and only with the order: the
  // database rejects an ETA on any other transition.
  const etaMinutes =
    body.next === "accepted" && body.etaMinutes !== undefined && body.etaMinutes !== null
      ? Number(body.etaMinutes)
      : null;

  // The database function re-checks membership, role and the state machine.
  const result = await transitionOrder(user, body.orderId, body.next as OrderStatus, body.reason, {
    etaMinutes,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, status: result.status, etaMinutes }, { headers: { "cache-control": "no-store" } });
}
