import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveAuthorizedRestaurant } from "@/lib/auth/identity";
import { getKitchenFeed } from "@/lib/services/orders";
import { errorResponseBody } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(request.url);
  const restaurantId = await resolveAuthorizedRestaurant(user, url.searchParams.get("restaurant"));
  if (!restaurantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const tickets = await getKitchenFeed(user, restaurantId);
    return NextResponse.json(
      { tickets, fetchedAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const mapped = errorResponseBody(error, "kitchen");
    return NextResponse.json(
      { error: mapped.status === 403 ? "forbidden" : "unavailable" },
      { status: mapped.status === 403 ? 403 : 503 },
    );
  }
}
