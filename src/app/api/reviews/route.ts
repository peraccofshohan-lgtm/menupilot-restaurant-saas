import { NextResponse } from "next/server";
import { submitReview, type ReviewKind } from "@/lib/services/reviews";
import { clientIdentity, consumeRateLimit } from "@/lib/services/rate-limit";

/**
 * Guest review submission.
 *
 * Trust boundary: the browser supplies the order's tracking token, which stars
 * were clicked and optional prose. Ownership, eligibility (served only),
 * duplicate protection and "was this dish on the order" are all decided inside
 * `submit_review()`. A rating posted without a valid token goes nowhere.
 */
export const dynamic = "force-dynamic";

interface Payload {
  token?: string;
  kind?: ReviewKind;
  menuItemId?: string | null;
  rating?: number;
  comment?: string | null;
  taste?: number | null;
  quality?: number | null;
  presentation?: number | null;
  service?: number | null;
  staff?: number | null;
  cleanliness?: number | null;
  photoPath?: string | null;
}

export async function POST(request: Request) {
  const identity = clientIdentity(request);
  const limit = await consumeRateLimit("review", identity, 12, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many attempts. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  if (!body.token || typeof body.token !== "string") {
    return NextResponse.json({ ok: false, error: "Open this page from your order link." }, { status: 400 });
  }
  if (body.kind !== "item" && body.kind !== "restaurant") {
    return NextResponse.json({ ok: false, error: "Unknown review type." }, { status: 400 });
  }

  const result = await submitReview({
    token: body.token,
    kind: body.kind,
    rating: Number(body.rating),
    menuItemId: body.menuItemId ?? null,
    comment: body.comment ?? null,
    taste: body.taste ?? null,
    quality: body.quality ?? null,
    presentation: body.presentation ?? null,
    service: body.service ?? null,
    staff: body.staff ?? null,
    cleanliness: body.cleanliness ?? null,
    photoPath: body.photoPath ?? null,
  });

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json(
    { ok: true, id: result.id, orderNumber: result.orderNumber },
    { headers: { "cache-control": "no-store" } },
  );
}
