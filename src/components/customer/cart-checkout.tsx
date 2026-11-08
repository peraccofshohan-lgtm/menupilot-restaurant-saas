"use client";

import { mediaUrl } from "@/lib/media";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ChefHat, Info, Minus, Plus, Receipt, Trash2, Users } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { PublicMenu } from "@/lib/services/orders";
import { useCart } from "@/lib/customer/cart";
import { cx } from "@/components/ui";

interface PlacedOrder {
  orderNumber: string;
  trackingToken: string | null;
  total: string;
  currency: string;
  itemCount: number;
  tableLabel: string;
  status: string;
}

/**
 * Cart review + submission.
 *
 * The displayed tax/service figures are an estimate computed from the menu payload;
 * the authoritative totals are recalculated by the database function and returned
 * with the created order. A stable idempotency key is generated per cart so a
 * double tap or flaky connection cannot create two orders.
 */
export function CartCheckout({ menu, qrToken }: { menu: PublicMenu; qrToken: string }) {
  const router = useRouter();
  const { lines, setQuantity, remove, clear, hydrateFor } = useCart();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [placed, setPlaced] = React.useState<PlacedOrder | null>(null);
  const idempotencyKey = React.useRef<string>("");

  React.useEffect(() => {
    hydrateFor(qrToken);
  }, [qrToken, hydrateFor]);

  React.useEffect(() => {
    // A fresh key per checkout attempt-set; regenerated whenever the cart changes
    // after a failed submission so the guest can retry meaningfully.
    if (!idempotencyKey.current) {
      idempotencyKey.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }, [lines]);

  const currency = menu.restaurant.currency;
  const detailed = lines
    .map((line) => {
      const item = menu.items.find((entry) => entry.id === line.menuItemId);
      return item ? { line, item } : null;
    })
    .filter((entry): entry is { line: (typeof lines)[number]; item: PublicMenu["items"][number] } => entry !== null);

  const subtotal = detailed.reduce((sum, entry) => sum + Number(entry.item.price) * entry.line.quantity, 0);
  const service = Math.round(subtotal * (Number(menu.settings.service_charge_rate) / 100) * 100) / 100;
  const tax = Math.round(subtotal * (Number(menu.settings.tax_rate) / 100) * 100) / 100;
  const total = subtotal + service + tax;
  const count = detailed.reduce((sum, entry) => sum + entry.line.quantity, 0);

  const unavailable = detailed.filter((entry) => !entry.item.is_available);
  const nameRequired = menu.settings.require_customer_name;

  async function submit() {
    if (detailed.length === 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          qrToken,
          items: detailed.map((entry) => ({
            menu_item_id: entry.item.id,
            quantity: entry.line.quantity,
            note: entry.line.note ?? null,
          })),
          customerName: name.trim() || undefined,
          customerPhone: phone.trim() || undefined,
          note: note.trim() || undefined,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const data = (await res.json()) as { ok: boolean; order?: PlacedOrder; error?: string };
      if (!data.ok || !data.order) {
        setError(data.error ?? "We could not place your order. Please try again.");
        setSubmitting(false);
        return;
      }
      clear();
      setPlaced(data.order);
      // A replay returns no token (the raw value was issued once). Stay on the
      // confirmation screen rather than navigating to a dead tracker link.
      if (data.order.trackingToken) {
        router.replace(`/order/${data.order.trackingToken}`);
      } else {
        setSubmitting(false);
      }
    } catch {
      setError("Your connection dropped while sending the order. Check with your server before trying again.");
      setSubmitting(false);
    }
  }

  if (placed) {
    return (
      <main className="mx-auto max-w-lg px-4 py-14 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-moss-50 text-moss-600">
          <Receipt className="size-6" aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink-900">Order sent to the restaurant</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-600">
          {menu.table?.label ?? "Your table"} · {placed.itemCount} item{placed.itemCount === 1 ? "" : "s"} ·{" "}
          {formatMoney(placed.total, placed.currency)}
        </p>
        <p className="mt-1 text-[12.5px] text-ink-400">Reference {placed.orderNumber}</p>
        {placed.trackingToken ? (
          <Link
            href={`/order/${placed.trackingToken}`}
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-clay-600 px-5 text-[13.5px] font-semibold text-white"
          >
            Follow your order
          </Link>
        ) : (
          <p className="mx-auto mt-6 max-w-sm text-[12.5px] leading-relaxed text-ink-500">
            This order was already sent from this device, so the live tracker link is not shown again.
            Show your reference number at the counter.
          </p>
        )}
      </main>
    );
  }

  if (detailed.length === 0) {
    return (
      <main className="mx-auto max-w-lg px-4 py-14 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-ink-100 text-ink-500">
          <ChefHat className="size-5" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink-900">Your order is empty</h1>
        <p className="mt-1.5 text-[13px] text-ink-500">Add a few dishes from the menu and come back.</p>
        <Link
          href={`/menu/${menu.restaurant.slug}?t=${encodeURIComponent(qrToken)}`}
          className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-4 text-[13px] font-medium text-ink-800"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Back to the menu
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/menu/${menu.restaurant.slug}?t=${encodeURIComponent(qrToken)}`}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-500 hover:text-ink-800"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Menu
        </Link>
        {menu.table ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-moss-50 px-2 py-1 text-[11.5px] font-semibold text-moss-700 ring-1 ring-inset ring-moss-100">
            <Users className="size-3" aria-hidden /> {menu.table.label}
          </span>
        ) : null}
      </div>

      <h1 className="mt-3 text-xl font-semibold text-ink-900">Review your order</h1>
      <p className="mt-0.5 text-[12.5px] text-ink-500">
        {menu.restaurant.name} · payment at the counter after your meal
      </p>

      {unavailable.length > 0 ? (
        <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Some dishes just sold out</p>
            <p className="mt-0.5">
              {unavailable.map((entry) => entry.item.name).join(", ")} {unavailable.length === 1 ? "is" : "are"} no longer
              available. Remove {unavailable.length === 1 ? "it" : "them"} to continue.
            </p>
          </div>
        </div>
      ) : null}

      <ul className="mt-4 divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white">
        {detailed.map(({ line, item }) => (
          <li key={item.id} className="flex gap-3 p-3">
            <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-ink-100">
              {item.image_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl("menu", item.image_path)!} alt={item.name} className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-ink-300"><ChefHat className="size-4" aria-hidden /></span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-ink-900">{item.name}</p>
                  <p className="text-[12px] text-ink-500">
                    {formatMoney(item.price, currency)} each
                    {!item.is_available ? " · sold out" : ""}
                  </p>
                </div>
                <p className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-900">
                  {formatMoney(Number(item.price) * line.quantity, currency)}
                </p>
              </div>
              {line.note ? (
                <p className="mt-1 rounded bg-ink-50 px-1.5 py-0.5 text-[11.5px] text-ink-600">“{line.note}”</p>
              ) : null}
              <div className="mt-1.5 flex items-center gap-2">
                <div className="inline-flex items-center rounded-lg border border-ink-200">
                  <button
                    type="button"
                    onClick={() => setQuantity(item.id, line.quantity - 1)}
                    className="grid size-7 place-items-center rounded-l-lg text-ink-600 hover:bg-ink-100"
                    aria-label={`Decrease ${item.name}`}
                  >
                    <Minus className="size-3" aria-hidden />
                  </button>
                  <span className="min-w-7 text-center text-[12.5px] font-semibold tabular-nums">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(item.id, line.quantity + 1)}
                    className="grid size-7 place-items-center rounded-r-lg text-ink-600 hover:bg-ink-100"
                    aria-label={`Increase ${item.name}`}
                  >
                    <Plus className="size-3" aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-red-600 hover:underline"
                >
                  <Trash2 className="size-3" aria-hidden /> Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-4 rounded-xl border border-ink-200 bg-white p-3.5">
        <h2 className="text-[13px] font-semibold text-ink-900">Table &amp; guest details</h2>
        <p className="mt-0.5 text-[11.5px] text-ink-500">
          {menu.table?.label ?? "Your table"} is attached automatically by your QR code — you cannot change it here.
        </p>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <div>
            <label htmlFor="guest-name" className="text-[12px] font-medium text-ink-700">
              Name {nameRequired ? <span className="text-clay-600">*</span> : <span className="font-normal text-ink-400">(optional)</span>}
            </label>
            <input
              id="guest-name"
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 80))}
              placeholder="So we can call your name"
              className="mt-1 h-10 w-full rounded-lg border border-ink-200 px-2.5 text-[13px] focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
            />
          </div>
          <div>
            <label htmlFor="guest-phone" className="text-[12px] font-medium text-ink-700">
              Phone <span className="font-normal text-ink-400">(optional)</span>
            </label>
            <input
              id="guest-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value.slice(0, 24))}
              inputMode="tel"
              placeholder="For your receipt"
              className="mt-1 h-10 w-full rounded-lg border border-ink-200 px-2.5 text-[13px] focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
            />
          </div>
        </div>
        <div className="mt-2.5">
          <label htmlFor="order-note" className="text-[12px] font-medium text-ink-700">
            Note for the kitchen <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <textarea
            id="order-note"
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 300))}
            rows={2}
            placeholder="Allergies, timing, anything we should know"
            className="mt-1 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-[13px] focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
          />
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-ink-200 bg-white p-3.5">
        <h2 className="text-[13px] font-semibold text-ink-900">Bill estimate</h2>
        <dl className="mt-2 space-y-1.5 text-[12.5px]">
          <div className="flex justify-between"><dt className="text-ink-500">Subtotal ({count} items)</dt><dd className="font-medium tabular-nums">{formatMoney(subtotal, currency)}</dd></div>
          {Number(menu.settings.service_charge_rate) > 0 ? (
            <div className="flex justify-between"><dt className="text-ink-500">{menu.settings.service_charge_label} ({Number(menu.settings.service_charge_rate)}%)</dt><dd className="font-medium tabular-nums">{formatMoney(service, currency)}</dd></div>
          ) : null}
          {Number(menu.settings.tax_rate) > 0 ? (
            <div className="flex justify-between"><dt className="text-ink-500">{menu.settings.tax_label} ({Number(menu.settings.tax_rate)}%)</dt><dd className="font-medium tabular-nums">{formatMoney(tax, currency)}</dd></div>
          ) : null}
          <div className="flex justify-between border-t border-ink-100 pt-1.5">
            <dt className="text-[13px] font-semibold text-ink-900">Total</dt>
            <dd className="text-[14px] font-semibold tabular-nums text-ink-900">{formatMoney(total, currency)}</dd>
          </div>
        </dl>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          The restaurant recalculates this total from its live menu when your order is received, so the final figure may
          differ if a price changed while you were browsing.
        </p>
      </section>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700 ring-1 ring-inset ring-red-200" role="alert">
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-ink-500">{count} item{count === 1 ? "" : "s"} · {menu.table?.label ?? "Table"}</p>
            <p className="text-[15px] font-semibold tabular-nums text-ink-900">{formatMoney(total, currency)}</p>
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || unavailable.length > 0 || (nameRequired && !name.trim())}
            className={cx(
              "inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[13.5px] font-semibold text-white",
              submitting || unavailable.length > 0 || (nameRequired && !name.trim())
                ? "bg-ink-300"
                : "bg-clay-600 hover:bg-clay-700",
            )}
          >
            {submitting ? "Sending…" : "Place order"}
          </button>
        </div>
        {nameRequired && !name.trim() ? (
          <p className="mx-auto mt-1 max-w-2xl text-[11px] text-amber-700">This restaurant asks for a name with every order.</p>
        ) : null}
      </div>
    </main>
  );
}
