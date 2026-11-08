import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { requirePlatformAdmin, setRestaurantStatus } from "@/lib/services/platform";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  if (!(await requirePlatformAdmin(user))) {
    return NextResponse.json({ ok: false, error: "Platform administrator access required." }, { status: 403 });
  }

  let body: { restaurantId?: string; status?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  if (!body.restaurantId || !["active", "suspended", "pending"].includes(body.status ?? "")) {
    return NextResponse.json({ ok: false, error: "Unknown restaurant or status." }, { status: 400 });
  }

  const result = await setRestaurantStatus(user, body.restaurantId, body.status as "active" | "suspended" | "pending");
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}
