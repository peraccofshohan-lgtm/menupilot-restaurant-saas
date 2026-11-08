import { NextResponse } from "next/server";
import { createOrder } from "@/lib/services/orders";
import { clientIdentity, consumeRateLimit } from "@/lib/services/rate-limit";

/**
 * Public order submission.
 *
 * Trust boundary: the browser supplies only the QR token, menu item ids,
 * quantities, notes and optional guest details. Prices, totals, availability,
 * restaurant and table identity are all resolved server-side inside
 * `create_order()`, which also enforces idempotency.
 */
export const dynamic = "force-dynamic";

interface Payload {
  qrToken?: string;
  items?: { menu_item_id?: string; quantity?: number; note?: string | null }[];
  customerName?: string;
  customerPhone?: string;
  note?: string;
  idempotencyKey?: string;
}

export async function POST(request: Request) {
  const identity = clientIdentity(request);
  const limit = await consumeRateLimit("order", identity, 8, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many orders from this device. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  if (!payload.qrToken || typeof payload.qrToken !== "string") {
    return NextResponse.json({ ok: false, error: "Scan the QR code on your table to order." }, { status: 400 });
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return NextResponse.json({ ok: false, error: "Your cart is empty." }, { status: 400 });
  }

  const result = await createOrder({
    qrToken: payload.qrToken,
    items: payload.items.map((line) => ({
      menu_item_id: String(line.menu_item_id ?? ""),
      quantity: Number(line.quantity) || 0,
      note: line.note ? String(line.note) : null,
    })),
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    note: payload.note,
    idempotencyKey: payload.idempotencyKey,
  });

  if (!result.ok || !result.order) {
    return NextResponse.json({ ok: false, error: result.error ?? "We could not place your order." }, { status: 422 });
  }

  return NextResponse.json(
    {
      ok: true,
      order: {
        orderNumber: result.order.order_number,
        // Null on an idempotent replay: the raw token is issued once, to the device
        // that placed the order. The client renders "already placed" without a link.
        trackingToken: result.order.tracking_token,
        status: result.order.status,
        total: result.order.total,
        currency: result.order.currency,
        itemCount: result.order.item_count,
        tableLabel: result.order.table_label,
        idempotentReplay: result.order.idempotent_replay,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
