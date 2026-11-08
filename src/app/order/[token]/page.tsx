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
import { getTrackedOrder, orderNotifications } from "@/lib/services/orders";
import { getTranslator } from "@/lib/i18n/server";
import { localizedName } from "@/lib/i18n/content";
import { etaState } from "@/lib/services/reviews";
import { formatDateTime, formatMoney, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("track.title"), robots: { index: false, follow: false } };
}

const STEPS = [
  { key: "pending", labelKey: "track.step.placed", detailKey: "track.step.placedDetail" },
  { key: "accepted", labelKey: "track.step.accepted", detailKey: "track.step.acceptedDetail" },
  { key: "preparing", labelKey: "track.step.preparing", detailKey: "track.step.preparingDetail" },
  { key: "ready", labelKey: "track.step.ready", detailKey: "track.step.readyDetail" },
  { key: "served", labelKey: "track.step.served", detailKey: "track.step.servedDetail" },
];

export default async function OrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getTranslator();
  const order = await getTrackedOrder(token);
  if (!order) notFound();

  const isClosed = order.status === "rejected" || order.status === "cancelled";
  const activeIndex = STEPS.findIndex((step) => step.key === order.status);
  const eta = etaState(order);
  const reviewedItems = new Set((order.reviews.item_reviewed ?? []).filter(Boolean) as string[]);
  const canReview = order.reviews?.visited === true;
  // The feed is derived from the order snapshot, so it refreshes whenever the
  // polling tracker refreshes the page — no separate notification store to drift.
  const feed = orderNotifications(order);

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
              <p className="text-[11px] uppercase tracking-wide text-ink-400">{t("track.currentStatus")}</p>
              <p className="mt-0.5 text-[16px] font-semibold text-ink-900">
                {isClosed
                  ? order.status === "rejected" ? t("track.rejected") : t("track.cancelled")
                  : t(STEPS[Math.max(0, activeIndex)]?.labelKey ?? "track.step.placed")}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-500">
                {isClosed
                  ? order.rejection_reason ?? t("track.rejectedHint")
                  : t(STEPS[Math.max(0, activeIndex)]?.detailKey ?? "track.step.placedDetail")}
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
                        {t(step.labelKey)}
                      </p>
                      <p className="text-[11.5px] text-ink-400">{t(step.detailKey)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </Card>

        {feed.length > 0 ? (
          <Card className="mt-4 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink-900">{t("track.activity")}</h2>
              <span className="text-[10.5px] text-ink-400">{t("track.activityAuto")}</span>
            </div>
            <ol className="mt-2.5 space-y-0">
              {feed.map((event, index) => (
                <li key={event.key} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <span
                      className={
                        event.tone === "good"
                          ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-moss-600"
                          : event.tone === "warn"
                            ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-clay-600"
                            : "mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-300"
                      }
                      aria-hidden
                    />
                    {index < feed.length - 1 ? <span className="my-1 w-px flex-1 bg-ink-200" aria-hidden /> : null}
                  </div>
                  <div className={index < feed.length - 1 ? "pb-2.5" : ""}>
                    <p className="text-[12.5px] font-medium text-ink-800">{event.title}</p>
                    <p className="text-[11.5px] leading-snug text-ink-500">{event.detail}</p>
                    {event.at ? <p className="mt-0.5 text-[10.5px] text-ink-400">{timeAgo(event.at)}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

        <Card className="mt-4 p-4">
          <h2 className="text-[13px] font-semibold text-ink-900">{t("track.ourOrder")}</h2>
          <ul className="mt-2 divide-y divide-ink-100">
            {order.items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] text-ink-800">
                    <span className="mr-1.5 inline-flex min-w-5 justify-center rounded bg-ink-100 px-1 text-[11px] font-semibold tabular-nums text-ink-600">
                      {item.quantity}×
                    </span>
                    {localizedName(item)}
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
            <div className="flex justify-between"><dt className="text-ink-500">{t("cart.subtotal")}</dt><dd className="tabular-nums">{formatMoney(order.subtotal, order.currency)}</dd></div>
            {Number(order.service_charge) > 0 ? <div className="flex justify-between"><dt className="text-ink-500">{t("cart.serviceCharge")}</dt><dd className="tabular-nums">{formatMoney(order.service_charge, order.currency)}</dd></div> : null}
            {Number(order.tax_amount) > 0 ? <div className="flex justify-between"><dt className="text-ink-500">{t("cart.tax")}</dt><dd className="tabular-nums">{formatMoney(order.tax_amount, order.currency)}</dd></div> : null}
            <div className="flex justify-between border-t border-ink-100 pt-1"><dt className="font-semibold text-ink-900">{t("cart.total")}</dt><dd className="text-[14px] font-semibold tabular-nums text-ink-900">{formatMoney(order.total, order.currency)}</dd></div>
          </dl>
          <p className="mt-2 text-[11.5px] text-ink-400">
            {t("track.placedAt", {
              time: formatDateTime(order.placed_at),
              ago: timeAgo(order.placed_at),
            })} · {t("track.payment", {
              status: order.payment_status === "paid" ? t("track.paymentSettled") : t("track.paymentCounter"),
            })}
          </p>
        </Card>

        {canReview ? (
          <Card className="mt-4 p-4">
            <div className="flex items-start gap-2">
              <Star className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              <div>
                <h2 className="text-[13px] font-semibold text-ink-900">{t("review.title")}</h2>
                <p className="text-[11.5px] text-ink-500">
                  {t("review.prompt")}
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
                        {t("review.restaurantReplied", { name: order.restaurant.name })}
                        {review.item_name ? ` · ${localizedName({ name: review.item_name })}` : ""}
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
                  name: localizedName(item),
                  reviewed: reviewedItems.has(item.menu_item_id as string),
                }))}
              restaurantReviewed={Boolean(order.reviews.restaurant_reviewed)}
            />
          </Card>
        ) : !isClosed ? (
          <Card className="mt-4 p-4">
            <p className="text-[12px] text-ink-500">
              {t("review.onlyServed")}
            </p>
          </Card>
        ) : null}

        {!isClosed ? (
          <Card className="mt-4 p-4">
            <h2 className="text-[13px] font-semibold text-ink-900">{t("service.title")}</h2>
            <p className="text-[11.5px] text-ink-500">{t("service.notePlaceholder")}</p>
            <ServiceRequest token={token} existing={order.service_requests ?? []} />
          </Card>
        ) : null}

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-ink-400">
          {t("track.activityAuto")}
          {order.restaurant.phone ? (
            <>
              <br />
              {t("menu.callRestaurant")}{" "}
              <a href={`tel:${order.restaurant.phone}`} className="font-medium text-clay-700 hover:underline">
                {order.restaurant.phone}
              </a>
            </>
          ) : null}
          <br />
          <Link href={`/menu/${order.restaurant.slug}`} className="font-medium text-clay-700 hover:underline">
            {t("history.viewMenu")}
          </Link>
        </p>
      </div>
    </main>
  );
}
