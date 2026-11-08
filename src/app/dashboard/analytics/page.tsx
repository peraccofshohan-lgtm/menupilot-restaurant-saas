import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3, Coins, Percent, ShoppingBasket, Star } from "lucide-react";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, cx } from "@/components/ui";
import { requireTenant } from "@/lib/auth/server";
import { getAnalytics } from "@/lib/services/overview";
import { getReviews } from "@/lib/services/reviews";
import { formatMoney, formatNumber, percent } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "হিসাব ও রিপোর্ট" };

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const tenant = await requireTenant(["owner", "manager"]);
  const params = await searchParams;

  const today = new Date();
  const days = Number(params.range ?? "30");
  const rangeDays = [7, 30, 90].includes(days) ? days : 30;
  const from = params.from ?? isoDate(new Date(today.getTime() - (rangeDays - 1) * 86_400_000));
  const to = params.to ?? isoDate(today);

  let data;
  try {
    data = await getAnalytics(tenant.user, tenant.restaurantId, from, to);
  } catch (error) {
    console.error("[analytics] load failed", error);
    return (
      <div className="space-y-4">
        <PageHeader title="Analytics" />
        <Alert tone="error" title="Reports could not be loaded">
          The aggregate query failed. Check the date range and try again; technical detail is in the server logs.
        </Alert>
      </div>
    );
  }

  // Ratings are their own report; a failure here must not take the money report
  // down with it, so it is loaded defensively.
  const reviews = await getReviews(tenant.user, tenant.restaurantId).catch(() => null);

  const currency = tenant.currency;
  const revenue = Number(data.totals.revenue);
  const daily = data.daily ?? [];
  const peak = Math.max(1, ...daily.map((day) => Number(day.revenue)));
  const half = Math.floor(daily.length / 2);
  const firstHalf = daily.slice(0, half).reduce((sum, day) => sum + Number(day.revenue), 0);
  const secondHalf = daily.slice(half).reduce((sum, day) => sum + Number(day.revenue), 0);
  const trend = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : secondHalf > 0 ? 100 : 0;

  const statuses = Object.entries(data.status_breakdown ?? {}).sort((a, b) => b[1] - a[1]);
  const totalOrders = statuses.reduce((sum, [, count]) => sum + count, 0);

  // Popularity is ranked by quantity sold, not revenue: the question "what do
  // people actually order" is different from "what makes the most money", and
  // a cheap dish that every table adds is worth seeing on its own.
  const unitsSold = data.top_items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const topDish = [...data.top_items].sort((a, b) => Number(b.quantity) - Number(a.quantity))[0] ?? null;
  const topCategory =
    [...data.category_performance].sort((a, b) => Number(b.quantity) - Number(a.quantity))[0] ?? null;
  const categoryUnits = data.category_performance.reduce((sum, category) => sum + Number(category.quantity), 0);

  const hasData = Number(data.totals.orders) > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        description={`Business days follow ${data.time_zone ?? tenant.timeZone}. Revenue counts only orders you actually completed — ready and served.`}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-0.5">
            {RANGES.map((range) => (
              <Link
                key={range.key}
                href={`/dashboard/analytics?range=${range.key}`}
                className={cx(
                  "rounded-md px-2.5 py-1 text-[12px] font-medium",
                  String(rangeDays) === range.key ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50",
                )}
              >
                {range.label}
              </Link>
            ))}
          </div>
        }
      />

      <Card className="flex flex-wrap items-end gap-2 p-3">
        <form action="/dashboard/analytics" method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="from" className="block text-[11px] font-medium text-ink-500">From</label>
            <input id="from" type="date" name="from" defaultValue={from} className="h-8 rounded-lg border border-ink-200 px-2 text-[12.5px]" />
          </div>
          <div>
            <label htmlFor="to" className="block text-[11px] font-medium text-ink-500">To</label>
            <input id="to" type="date" name="to" defaultValue={to} className="h-8 rounded-lg border border-ink-200 px-2 text-[12.5px]" />
          </div>
          <button type="submit" className="h-8 rounded-lg bg-ink-900 px-3 text-[12px] font-medium text-white hover:bg-ink-800">Apply</button>
        </form>
        <p className="ml-auto text-[11.5px] text-ink-400">
          {data.totals.rejected_orders} rejected · {data.totals.cancelled_orders} cancelled (excluded from revenue)
        </p>
      </Card>

      {!hasData ? (
        <Card>
          <EmptyState
            icon={<BarChart3 className="size-4" aria-hidden />}
            title="No orders in this range"
            description="Pick a wider date range, or place a test order from a table QR to see how the reports fill in."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue" value={formatMoney(revenue, currency)} hint="Ready + served orders" icon={<Coins className="size-4" aria-hidden />} tone="moss" />
            <Stat label="Orders" value={formatNumber(Number(data.totals.orders))} hint={`${data.totals.completed_orders} completed`} icon={<ShoppingBasket className="size-4" aria-hidden />} />
            <Stat label="Average order" value={formatMoney(Number(data.totals.avg_order_value), currency)} hint="Across completed orders" icon={<Percent className="size-4" aria-hidden />} tone="clay" />
            <Stat
              label="Trend"
              value={
                <span className="inline-flex items-center gap-1">
                  {trend >= 0 ? <ArrowUpRight className="size-5 text-moss-600" aria-hidden /> : <ArrowDownRight className="size-5 text-red-500" aria-hidden />}
                  {Math.abs(trend)}%
                </span>
              }
              hint="Second half vs first half"
              tone={trend >= 0 ? "moss" : "red"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Visit rating"
              value={reviews && reviews.restaurant.count > 0 ? Number(reviews.restaurant.average).toFixed(2) : "—"}
              hint={`${reviews?.restaurant.count ?? 0} visit review${reviews?.restaurant.count === 1 ? "" : "s"}`}
              icon={<Star className="size-4" aria-hidden />}
              tone="amber"
            />
            <Stat
              label="Dishes rated"
              value={reviews ? reviews.items.length : 0}
              hint={reviews ? `${reviews.recent.filter((r) => r.kind === "item").length} recent dish reviews` : "Unavailable"}
              icon={<Star className="size-4" aria-hidden />}
            />
            <Stat
              label="5-star visits"
              value={reviews?.restaurant.five_star ?? 0}
              hint={`${reviews?.restaurant.low_star ?? 0} at 2 stars or below`}
            />
            <Stat
              label="Service score"
              value={reviews && reviews.restaurant.count > 0 ? Number(reviews.restaurant.service).toFixed(1) : "—"}
              hint="Out of 5, from visit reviews"
            />
          </div>

          <Card>
            <CardHeader title="Revenue by day" description={`${daily.length} business days · ${currency}`} />
            <CardBody className="pt-0">
              <div className="flex h-40 items-end gap-[3px]" role="img" aria-label="Daily revenue bar chart">
                {daily.map((day) => {
                  const height = Math.max(2, Math.round((Number(day.revenue) / peak) * 100));
                  const weekend = [0, 5, 6].includes(new Date(`${day.day}T12:00:00Z`).getUTCDay());
                  return (
                    <div key={day.day} className="group relative flex-1">
                      <div
                        className={cx("w-full rounded-t-sm transition-colors", weekend ? "bg-clay-400" : "bg-clay-500/70", "group-hover:bg-clay-600")}
                        style={{ height: `${height}%` }}
                      />
                      <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block">
                        {formatMoney(day.revenue, currency)} · {day.orders}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between text-[10.5px] text-ink-400">
                <span>{daily[0]?.day}</span>
                <span>{daily[daily.length - 1]?.day}</span>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Order status mix" description="Every order placed in this range." />
              <CardBody className="space-y-2 pt-0">
                {statuses.map(([status, count]) => (
                  <div key={status}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12.5px] capitalize text-ink-700">{status}</span>
                      <span className="text-[11.5px] tabular-nums text-ink-500">{count} · {percent(count, totalOrders)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className={cx(
                          "h-full rounded-full",
                          status === "served" ? "bg-moss-500" : status === "rejected" || status === "cancelled" ? "bg-red-300" : "bg-clay-400",
                        )}
                        style={{ width: `${Math.max(3, percent(count, totalOrders))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Top dishes" description="By quantity in completed orders." />
              <CardBody className="pt-0">
                {data.top_items.length === 0 ? (
                  <EmptyState compact title="No completed orders yet" description="Top dishes appear once orders are served." />
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {data.top_items.map((item, index) => (
                      <li key={item.name} className="flex items-center justify-between gap-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-[11px] tabular-nums text-ink-400">{String(index + 1).padStart(2, "0")}</span>
                          <p className="truncate text-[12.5px] font-medium text-ink-800">{item.name}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[12px] font-semibold tabular-nums text-ink-900">{formatMoney(item.revenue, currency)}</p>
                          <p className="text-[10.5px] text-ink-400">{item.quantity} sold</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Most popular" description="Ranked by plates sold, not by revenue." />
              <CardBody className="pt-0">
                {!topDish && !topCategory ? (
                  <EmptyState compact title="Nothing sold yet" description="Popularity appears once dishes are served." />
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {topDish ? (
                      <li className="py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate text-[12.5px] font-medium text-ink-800">
                            <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Dish</span>
                            {topDish.name}
                          </p>
                          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-ink-900">
                            {formatNumber(Number(topDish.quantity))} sold
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {percent(Number(topDish.quantity), unitsSold)}% of all plates · {formatMoney(topDish.revenue, currency)}
                        </p>
                      </li>
                    ) : null}
                    {topCategory ? (
                      <li className="py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate text-[12.5px] font-medium text-ink-800">
                            <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">Category</span>
                            {topCategory.name}
                          </p>
                          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-ink-900">
                            {formatNumber(Number(topCategory.quantity))} sold
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {percent(Number(topCategory.quantity), categoryUnits)}% of all plates
                        </p>
                      </li>
                    ) : null}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          {data.category_performance.length > 0 ? (
            <Card>
              <CardHeader title="Category performance" description="Where the revenue actually comes from." />
              <CardBody className="pt-0">
                <ul className="space-y-2.5">
                  {data.category_performance.map((category) => (
                    <li key={category.name}>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12.5px] font-medium text-ink-800">{category.name}</span>
                        <span className="text-[11.5px] tabular-nums text-ink-500">{formatMoney(category.revenue, currency)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-ink-700" style={{ width: `${Math.max(4, percent(Number(category.revenue), revenue))}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <p className="text-[11.5px] leading-relaxed text-ink-400">
            Methodology: an order counts toward revenue only when its status is <Badge tone="moss">ready</Badge> or{" "}
            <Badge tone="moss">served</Badge>. Rejected and cancelled orders are excluded from every money figure, and
            business days are cut in {data.time_zone ?? tenant.timeZone}.
          </p>
        </>
      )}
    </div>
  );
}
