import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveAuthorizedRestaurant } from "@/lib/auth/identity";
import { getServiceBoard, setServiceStatus, setItemPrep } from "@/lib/services/reviews";

/** Staff service board: read, acknowledge, complete. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Your session has expired." }, { status: 401 });

  const url = new URL(request.url);
  const restaurantId = await resolveAuthorizedRestaurant(user, url.searchParams.get("restaurantId"));
  if (!restaurantId) {
    return NextResponse.json({ ok: false, error: "You do not have access to that restaurant." }, { status: 403 });
  }

  const requests = await getServiceBoard(user, restaurantId);
  return NextResponse.json(
    { ok: true, requests, fetchedAt: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Your session has expired." }, { status: 401 });

  let body: { requestId?: string; itemId?: string; status?: string; restaurantId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  const restaurantId = await resolveAuthorizedRestaurant(user, body.restaurantId ?? null);
  if (!restaurantId) {
    return NextResponse.json({ ok: false, error: "You do not have access to that restaurant." }, { status: 403 });
  }

  // A line's prep state travels through the same route so the kitchen screen
  // has one endpoint for "something on this ticket changed".
  if (body.itemId) {
    if (body.status !== "queued" && body.status !== "preparing" && body.status !== "done") {
      return NextResponse.json({ ok: false, error: "Unknown status." }, { status: 400 });
    }
    const result = await setItemPrep(user, body.itemId, body.status);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  }

  if (!body.requestId) return NextResponse.json({ ok: false, error: "Unknown request." }, { status: 400 });
  if (body.status !== "acknowledged" && body.status !== "completed" && body.status !== "cancelled") {
    return NextResponse.json({ ok: false, error: "Unknown status." }, { status: 400 });
  }

  const result = await setServiceStatus(user, body.requestId, body.status);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
