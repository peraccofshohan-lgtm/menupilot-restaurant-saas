import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveAuthorizedRestaurant } from "@/lib/auth/identity";
import { listOrders } from "@/lib/services/orders";

/**
 * Polling feed for the overview and orders screens.
 *
 * Reads use the signed-in user's RLS identity, so a manipulated ?restaurant=
 * parameter cannot expose another tenant's orders. Cache-Control: no-store keeps
 * the browser from showing a stale ticket count.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(request.url);
  const requested = url.searchParams.get("restaurant");
  const restaurantId = await resolveAuthorizedRestaurant(user, requested);
  if (!restaurantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const status = url.searchParams.get("status") ?? "active";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), 50);

  try {
    const { orders, total } = await listOrders(user, restaurantId, {
      status: status === "active" ? "active" : status === "pending" ? "pending" : "all",
      limit,
    });
    return NextResponse.json(
      {
        restaurantId,
        total,
        pending: orders.filter((o) => o.status === "pending").length,
        orders,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[feed] orders query failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
