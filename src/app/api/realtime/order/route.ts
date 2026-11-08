import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { getTrackedOrder } from "@/lib/services/orders";
import { serverEnv } from "@/lib/env";

/**
 * Realtime token for a guest tracking a single order.
 *
 * The guest has no account, so the order's tracking token *is* the credential.
 * It is hashed and looked up with the same `get_order_tracking()` function the
 * tracking page uses, which only ever resolves live orders.
 *
 * The issued JWT is scoped to one topic, `order:<tracking token hash prefix>`, so
 * a guest can watch their own ticket and nothing else: they never learn another
 * order's id, table, or restaurant, and the topic cannot be guessed because the
 * hash is derived server-side from a 256-bit token.
 */
export const dynamic = "force-dynamic";

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (token.length < 16) {
    return NextResponse.json({ configured: false, error: "invalid_token" }, { status: 400 });
  }

  const order = await getTrackedOrder(token);
  if (!order) {
    return NextResponse.json({ configured: false, error: "not_found" }, { status: 404 });
  }

  const supabase = serverEnv.supabase;
  const secret = process.env.REALTIME_JWT_SECRET || process.env.JWT_SECRET;
  if (!supabase.configured || !secret) {
    return NextResponse.json({ configured: false, reason: "realtime_not_configured" });
  }

  // Derive the topic from the token itself, never from a client-supplied id.
  const topicKey = createHmac("sha256", secret).update(`order:${token}`).digest("hex").slice(0, 32);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: "menupilot",
      sub: `guest:${topicKey}`,
      aud: "menu-pilot",
      role: "anon",
      iat: now,
      exp: now + 60 * 60,
      mp_topic: `order:${topicKey}`,
    }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");

  return NextResponse.json(
    {
      configured: true,
      url: supabase.url,
      anonKey: supabase.anonKey,
      token: `${header}.${payload}.${signature}`,
      topic: `order:${topicKey}`,
      status: order.status,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
