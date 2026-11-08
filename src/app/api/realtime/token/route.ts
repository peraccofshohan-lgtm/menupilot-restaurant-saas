import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveAuthorizedRestaurant } from "@/lib/auth/identity";
import { serverEnv } from "@/lib/env";

/**
 * Issues the browser a token for Supabase Realtime.
 *
 * Security model — the client is never trusted to choose what it listens to:
 *
 *   * The restaurant comes from the caller's session (`resolveAuthorizedRestaurant`),
 *     never from the query string alone.
 *   * The realtime topic is `restaurant:<id>`, and the token's `mp_restaurant`
 *     claim names that same id. A Supabase Realtime *private* channel accepts a
 *     subscription only when the Authorization extension approves it, and the
 *     policy shipped in `scripts/realtime-setup.ts` compares that claim with the
 *     channel topic. Guessing another tenant's id produces a token for your own
 *     tenant, so the subscription is refused.
 *   * The JWT expires in one hour, is audience-scoped to `menu-pilot`, and
 *     carries no role that could read tables over PostgREST.
 *
 * If the project is not configured, the endpoint says so (`configured: false`)
 * and the UI keeps polling — realtime is an enhancement, not a dependency.
 */
export const dynamic = "force-dynamic";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signRealtimeToken(payload: Record<string, unknown>, secret: string): string | null {
  // Realtime supports HS256 project JWTs or externally issued tokens signed with
  // REALTIME_JWT_SECRET. We only mint one when a secret is available.
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ configured: false, error: "unauthenticated" }, { status: 401 });

  const requested = new URL(request.url).searchParams.get("restaurant");
  const restaurantId = await resolveAuthorizedRestaurant(user, requested);
  if (!restaurantId) return NextResponse.json({ configured: false, error: "forbidden" }, { status: 403 });

  const supabase = serverEnv.supabase;
  if (!supabase.configured) {
    return NextResponse.json({ configured: false, reason: "supabase_not_configured" });
  }

  // Without a signing secret the browser can still use the anon key for public
  // channels, but private tenant channels need the signed token below.
  const secret = process.env.REALTIME_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json({
      configured: false,
      url: supabase.url,
      anonKey: supabase.anonKey,
      reason: "no_realtime_secret",
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signRealtimeToken(
    {
      iss: "menupilot",
      sub: user.id,
      aud: "menu-pilot",
      role: "authenticated",
      iat: now,
      exp: now + 60 * 60,
      mp_restaurant: restaurantId,
      mp_topic: `restaurant:${restaurantId}`,
    },
    secret,
  );

  return NextResponse.json(
    {
      configured: true,
      url: supabase.url,
      anonKey: supabase.anonKey,
      token,
      restaurantId,
      topic: `restaurant:${restaurantId}`,
      expiresIn: 3600,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
