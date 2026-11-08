import { NextResponse } from "next/server";
import { requestService, type ServiceKind } from "@/lib/services/reviews";
import { clientIdentity, consumeRateLimit } from "@/lib/services/rate-limit";

/**
 * Guest service request (call waiter, water, plate, bill, other).
 *
 * The token identifies the order, and the order identifies the table — a guest
 * cannot raise a request against someone else's table. Duplicate protection is
 * a partial unique index in the database (`service_requests_one_open_per_kind`),
 * so hammering the button creates one request, not five. The rate limit here is
 * the outer layer, for request floods that never reach an insert.
 */
export const dynamic = "force-dynamic";

const KINDS: ServiceKind[] = ["waiter", "water", "plate", "bill", "other"];

export async function POST(request: Request) {
  const identity = clientIdentity(request);
  const limit = await consumeRateLimit("service", identity, 10, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many requests. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { token?: string; kind?: ServiceKind; body?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  if (!body.token || typeof body.token !== "string") {
    return NextResponse.json({ ok: false, error: "Open this page from your order link." }, { status: 400 });
  }
  if (!body.kind || !KINDS.includes(body.kind)) {
    return NextResponse.json({ ok: false, error: "Unknown request type." }, { status: 400 });
  }

  const result = await requestService(body.token, body.kind, body.body ?? null);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, id: result.id }, { headers: { "cache-control": "no-store" } });
}
