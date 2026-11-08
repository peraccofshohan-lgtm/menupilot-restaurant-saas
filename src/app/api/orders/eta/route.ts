import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveAuthorizedRestaurant } from "@/lib/auth/identity";
import { setOrderEta } from "@/lib/services/reviews";

/** Change an order's preparation estimate after acceptance. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Your session has expired." }, { status: 401 });

  let body: { orderId?: string; restaurantId?: string; minutes?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  if (!body.orderId || typeof body.minutes !== "number") {
    return NextResponse.json({ ok: false, error: "Choose a preparation time." }, { status: 400 });
  }

  const restaurantId = await resolveAuthorizedRestaurant(user, body.restaurantId ?? null);
  if (!restaurantId) {
    return NextResponse.json({ ok: false, error: "You do not have access to that restaurant." }, { status: 403 });
  }

  const result = await setOrderEta(user, body.orderId, Math.round(body.minutes));
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, etaMinutes: result.etaMinutes }, { headers: { "cache-control": "no-store" } });
}
