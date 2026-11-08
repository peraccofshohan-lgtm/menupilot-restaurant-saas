import { mediaUrl } from "@/lib/media";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChefHat, CircleCheck, Clock3, Star, XCircle } from "lucide-react";
import { Card } from "@/components/ui";
import { OrderTracker } from "@/components/customer/order-tracker";
import { EtaTimer } from "@/components/customer/eta-timer";
import { ServiceRequest } from "@/components/customer/service-request";
import { ReviewControls } from "@/components/customer/review-controls";
import { getTrackedOrder } from "@/lib/services/orders";
import { etaState } from "@/lib/services/reviews";
import { formatDateTime, formatMoney, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

const STEPS = [
  { key: "pending", label: "Order placed", detail: "Sent to the restaurant." },
  { key: "accepted", label: "Order accepted", detail: "The kitchen has your ticket." },
  { key: "preparing", label: "Preparing", detail: "Cooking now." },
  { key: "ready", label: "Ready", detail: "Coming to your table." },
  { key: "served", label: "Served", detail: "Enjoy your meal." },
];

export default async function OrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await getTrackedOrder(token);
  if (!order) notFound();

  const isClosed = order.status === "rejected" || order.status === "cancelled";
  const activeIndex = STEPS.findIndex((step) => step.key === order.status);
  const eta = etaState(order);
  const reviewedItems = new Set((order.reviews.item_reviewed ?? []).filter(Boolean) as string[]);
  const canReview = order.reviews?.visited === true;

  return (
    <main className="min-h-dvh bg-ink-50 pb-10">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {order.restaurant.logo_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl("branding", order.restaurant.logo_path)!} alt="" className="size-9 rounded-lg object-cover" />
            ) : (
              <span className="grid size-9 place-items-center rounded-lg bg-clay-600 text-white"><ChefHat className="size-4" aria-hidden /></span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink-900">{order.restaurant.name}</p>
              <p className="text-[11px] text-ink-400">{order.table_label ?? "Table"} · {order.order_number}</p>
            </div>
          </div>
          {order.restaurant.phone ? (
            <a href={`tel:${order.restaurant.phone}`} className="shrink-0 rounded-lg px-2 py-1 text-[11.5px] font-medium text-clay-700 hover:bg-clay-50">
              Call
            </a>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4">
        <OrderTracker token={token} initialStatus={order.status} />

        <Card className="mt-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-400">Current status</p>
              <p className="mt-0.5 text-[16px] font-semibold text-ink-900">
                {isClosed
                  ? order.status === "rejected" ? "The restaurant could not take this order" : "This order was cancelled"
                  : STEPS[Math.max(0, activeIndex)]?.label ?? "Pending"}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-500">
                {isClosed
                  ? order.rejection_reason ?? "Please speak to a member of staff."
                  : STEPS[Math.max(0, activeIndex)]?.detail}
              </p>
            </div>
            {isClosed ? <XCircle className="size-6 shrink-0 text-red-500" aria-hidden /> : <Clock3 className="size-6 shrink-0 text-clay-500" aria-hidden />}
          </div>

          {!isClosed ? (
            <div className="mt-3">
              <EtaTimer etaMinutes={order.eta_minutes} startedAt={eta.startedAt} status={order.status} />
            </div>
          ) : null}

          {!isClosed ? (
            <ol className="mt-4 space-y-0">
              {STEPS.map((step, index) => {
                const done = index < activeIndex;
                const current = index === activeIndex;
                return (
                  <li key={step.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={
                          done ? "grid size-6 place-items-center rounded-full bg-moss-600 text-white"
                            : current ? "grid size-6 place-items-center rounded-full bg-clay-600 text-white ring-4 ring-clay-100"
                            : "grid size-6 place-items-center rounded-full border border-ink-200 bg-white text-ink-300"
                        }
                      >
                        {done ? <CircleCheck className="size-3.5" aria-hidden /> : <span className="text-[10px] font-semibold">{index + 1}</span>}
                      </span>
                      {index < STEPS.length - 1 ? (
                        <span className={done ? "my-1 h-6 w-px bg-moss-500/40" : "my-1 h-6 w-px bg-ink-200"} aria-hidden />
                      ) : null}
                    </div>
                    <div className="pb-1">
                      <p className={current ? "text-[13px] font-semibold text-ink-900" : done ? "text-[13px] font-medium text-ink-700" : "text-[13px] text-ink-400"}>
                        {step.label}
                      </p>
                      <p className="text-[11.5px] text-ink-400">{step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </Card>

        <Card className="mt-4 p-4">
          <h2 className="text-[13px] font-semibold text-ink-900">Your order</h2>
          <ul className="mt-2 divide-y divide-ink-100">
            {order.items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] text-ink-800">
                    <span className="mr-1.5 inline-flex min-w-5 justify-center rounded bg-ink-100 px-1 text-[11px] font-semibold tabular-nums text-ink-600">
                      {item.quantity}×
                    </span>
                    {item.name}
                  </p>
                  {item.note ? <p className="text-[11.5px] text-clay-700">↳ {item.note}</p> : null}
                  {item.prep_status === "preparing" && order.status === "preparing" ? (
                    <p className="text-[11px] font-medium text-amber-700">Being cooked now</p>
                  ) : null}
                </div>
                <p className="shrink-0 text-[12.5px] font-medium tabular-nums text-ink-700">{formatMoney(item.line_total, order.currency)}</p>
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-1 border-t border-ink-100 pt-2 text-[12.5px]">
            <div className="flex justify-between"><dt className="text-ink-500">Subtotal</dt><dd className="tabular-nums">{formatMoney(order.subtotal, order.currency)}</dd></div>
            {Number(order.service_charge) > 0 ? <div className="flex justify-between"><dt className="text-ink-500">Service charge</dt><dd className="tabular-nums">{formatMoney(order.service_charge, order.currency)}</dd></div> : null}
            {Number(order.tax_amount) > 0 ? <div className="flex justify-between"><dt className="text-ink-500">Tax</dt><dd className="tabular-nums">{formatMoney(order.tax_amount, order.currency)}</dd></div> : null}
            <div className="flex justify-between border-t border-ink-100 pt-1"><dt className="font-semibold text-ink-900">Total</dt><dd className="text-[14px] font-semibold tabular-nums text-ink-900">{formatMoney(order.total, order.currency)}</dd></div>
          </dl>
          <p className="mt-2 text-[11.5px] text-ink-400">
            Placed {formatDateTime(order.placed_at)} · {timeAgo(order.placed_at)} · payment {order.payment_status === "paid" ? "settled" : "at the counter"}
          </p>
        </Card>

        {canReview ? (
          <Card className="mt-4 p-4">
            <div className="flex items-start gap-2">
              <Star className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              <div>
                <h2 className="text-[13px] font-semibold text-ink-900">How was your meal?</h2>
                <p className="text-[11.5px] text-ink-500">
                  You can rate each dish you ordered, and the visit as a whole.
                </p>
              </div>
            </div>
            {order.reviews.mine.some((review) => review.reply) ? (
              <div className="mt-3 space-y-2">
                {order.reviews.mine
                  .filter((review) => review.reply)
                  .map((review) => (
                    <div key={review.id} className="rounded-lg border-l-2 border-clay-300 bg-clay-50/60 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-clay-700">
                        {order.restaurant.name} replied
                        {review.item_name ? ` about ${review.item_name}` : ""}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-700">{review.reply}</p>
                    </div>
                  ))}
              </div>
            ) : null}
            <ReviewControls
              token={token}
              items={order.items
                .filter((item) => item.menu_item_id)
                .map((item) => ({
                  menuItemId: item.menu_item_id as string,
                  name: item.name,
                  reviewed: reviewedItems.has(item.menu_item_id as string),
                }))}
              restaurantReviewed={Boolean(order.reviews.restaurant_reviewed)}
            />
          </Card>
        ) : !isClosed ? (
          <Card className="mt-4 p-4">
            <p className="text-[12px] text-ink-500">
              Reviews open once your order has been served — you will see them here.
            </p>
          </Card>
        ) : null}

        {!isClosed ? (
          <Card className="mt-4 p-4">
            <h2 className="text-[13px] font-semibold text-ink-900">Need something?</h2>
            <p className="text-[11.5px] text-ink-500">Ask a member of staff without leaving your seat.</p>
            <ServiceRequest token={token} existing={order.service_requests ?? []} />
          </Card>
        ) : null}

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-ink-400">
          Keep this page open to follow progress. Bookmark it — the link is unique to your order and cannot be guessed.
          {order.restaurant.phone ? (
            <>
              <br />
              Questions? Call{" "}
              <a href={`tel:${order.restaurant.phone}`} className="font-medium text-clay-700 hover:underline">
                {order.restaurant.phone}
              </a>
            </>
          ) : null}
          <br />
          <Link href={`/menu/${order.restaurant.slug}`} className="font-medium text-clay-700 hover:underline">
            Back to {order.restaurant.name}
          </Link>
        </p>
      </div>
    </main>
  );
}
