import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ChefHat,
  ClipboardList,
  Clock3,
  Coins,
  FlaskConical,
  QrCode,
  TrendingUp,
  UtensilsCrossed,
} from "lucide-react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  ORDER_STATUS_KEY,
  OrderStatusBadge,
  Stat,
  cx,
} from "@/components/ui";
import { LiveOrders } from "@/components/dashboard/live-orders";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/server";
import { getOverview } from "@/lib/services/overview";
import { formatMoney, formatNumber, timeAgo, percent, formatLongDate, formatDay } from "@/lib/format";
import { getTranslator } from "@/lib/i18n/server";
import { localizedTableLabel } from "@/lib/i18n/content";
import { localizedName } from "@/lib/i18n/content";

export const dynamic = "force-dynamic";
export const metadata = { title: "সারসংক্ষেপ" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; welcome?: string }>;
}) {
  const tenant = await requireTenant();
  const params = await searchParams;

  if (tenant.role === "kitchen" || tenant.role === "waiter") {
    redirect("/dashboard/kitchen");
  }

  let overview;
  try {
    overview = await getOverview(tenant.user, tenant.restaurantId);
  } catch (error) {
    console.error("[dashboard] overview failed", error);
    return (
      <div className="mx-auto max-w-2xl py-10">
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-ink-900">We could not load your overview</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">
            The database did not return your metrics. Nothing has been changed. Refresh the page, and if this keeps
            happening check the server logs — the technical detail is recorded there.
          </p>
        </Card>
      </div>
    );
  }

  const { t } = await getTranslator();
  const currency = tenant.currency;
  const today = overview.today;
  const isNew = Number(today.orders) === 0 && overview.menu_item_count === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">
              {t("overview.greeting", { name: tenant.user.fullName?.split(" ")[0] ?? "" })}
            </h1>
            {tenant.isDemo ? <Badge tone="clay">{t("tenant.demoBadge")}</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] text-ink-500">
            {formatLongDate(`${overview.business_date}T12:00:00Z`, "UTC")}
            {overview.pending_orders > 0 ? (
              <span className="text-amber-700"> · {t("overview.pendingAction", { count: formatNumber(overview.pending_orders) })}</span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/dashboard/kitchen" variant="secondary" size="sm">
            <ChefHat className="size-3.5" aria-hidden /> {t("nav.kitchen")}
          </LinkButton>
          <LinkButton href="/dashboard/tables" size="sm">
            <QrCode className="size-3.5" aria-hidden /> {t("nav.tables")}
          </LinkButton>
        </div>
      </div>

      {params.denied ? (
        <div className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200" role="alert">
          {t("auth.forbidden")}
        </div>
      ) : null}

      {isNew ? (
        <Card className="border-clay-200 bg-clay-50/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-clay-600 ring-1 ring-inset ring-clay-200">
                <UtensilsCrossed className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-ink-900">{t("menuAdmin.empty")}</p>
                <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-ink-600">
                  {t("menuAdmin.imageHint")}
                </p>
              </div>
            </div>
            <LinkButton href="/dashboard/menu" size="sm">{t("menuAdmin.addDish")}</LinkButton>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("overview.todayOrders")}
          value={formatNumber(Number(today.orders))}
          hint={t("overview.pendingAction", { count: formatNumber(today.pending) })}
          icon={<ClipboardList className="size-4" aria-hidden />}
          tone="neutral"
        />
        <Stat
          label={t("overview.todayRevenue")}
          value={formatMoney(Number(today.revenue), currency)}
          hint={t("analytics.subtitle")}
          icon={<Coins className="size-4" aria-hidden />}
          tone="moss"
        />
        <Stat
          label={t("overview.avgOrder")}
          value={formatMoney(Number(today.avg_order_value), currency)}
          hint={t("orders.tab.served")}
          icon={<TrendingUp className="size-4" aria-hidden />}
          tone="clay"
        />
        <Stat
          label={t("overview.kitchenQueue")}
          value={formatNumber(overview.active_kitchen)}
          hint={t("orders.tab.ready")}
          icon={<ChefHat className="size-4" aria-hidden />}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <LiveOrders
          restaurantId={tenant.restaurantId}
          currency={currency}
          timeZone={overview.time_zone}
          initialPending={overview.pending_orders}
          canApprove={tenant.role === "owner" || tenant.role === "manager"}
        />

        <Card>
          <CardHeader
            title={t("overview.recentOrders")}
            description={t("orders.tab.all")}
            action={
              <Link href="/dashboard/orders" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-clay-700 hover:text-clay-800">
                {t("overview.viewAll")} <ArrowRight className="size-3" aria-hidden />
              </Link>
            }
          />
          <CardBody className="pt-0">
            {overview.recent_orders.length === 0 ? (
              <EmptyState
                compact
                icon={<Clock3 className="size-4" aria-hidden />}
                title={t("overview.noOrders")}
                description={t("overview.noOrdersHint")}
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {overview.recent_orders.map((order) => (
                  <li key={order.id}>
                    <Link href={`/dashboard/orders/${order.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-ink-50/60">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-semibold text-ink-800">{localizedTableLabel(order.table_label) ?? t("unit.table")}</span>
                          <OrderStatusBadge status={order.status} label={t(ORDER_STATUS_KEY[order.status] ?? order.status)} />
                        </div>
                        <p className="truncate text-[11.5px] text-ink-400">
                          {order.order_number} · {formatNumber(order.item_count)} {t("unit.items")} · {timeAgo(order.created_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink-900">
                        {formatMoney(order.total, currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t("analytics.topDishes")}
            description={t("analytics.topDishesHint")}
            action={
              <Link href="/dashboard/analytics" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-clay-700 hover:text-clay-800">
                <BarChart3 className="size-3" aria-hidden /> {t("nav.analytics")}
              </Link>
            }
          />
          <CardBody className="pt-0">
            {overview.popular_items.length === 0 ? (
              <EmptyState compact icon={<BarChart3 className="size-4" aria-hidden />} title={t("analytics.noData")} description={t("analytics.noDataHint")} />
            ) : (
              <ul className="space-y-2.5">
                {overview.popular_items.map((item, index) => {
                  const top = overview.popular_items[0]?.quantity ?? 1;
                  return (
                    <li key={item.name}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-[12.5px] font-medium text-ink-700">
                          <span className="mr-1.5 text-ink-400 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                          {item.name}
                        </p>
                        <p className="shrink-0 text-[11.5px] tabular-nums text-ink-500">
                          {t("analytics.soldCount", { count: formatNumber(item.quantity) })} · {formatMoney(item.revenue, currency)}
                        </p>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-clay-400" style={{ width: `${Math.max(6, percent(item.quantity, top))}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("nav.tables")}
            description={t("tables.count", { count: formatNumber(overview.table_count) })}
            action={
              <Link href="/dashboard/tables" className="text-[12.5px] font-medium text-clay-700 hover:text-clay-800">
                {t("action.edit")}
              </Link>
            }
          />
          <CardBody className="pt-0">
            {overview.tables.length === 0 ? (
              <EmptyState compact icon={<QrCode className="size-4" aria-hidden />} title={t("tables.empty")} description={t("tables.scanHint")} />
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {overview.tables.map((table) => (
                  <div
                    key={table.id}
                    className={cx(
                      "rounded-lg border px-1.5 py-2 text-center",
                      table.open_orders > 0 ? "border-clay-200 bg-clay-50" : "border-ink-200 bg-white",
                    )}
                    title={`${localizedTableLabel(table.label)}${table.zone ? ` · ${table.zone}` : ""} — ${formatNumber(table.open_orders)}`}
                  >
                    <p className="text-[11.5px] font-semibold text-ink-800">{localizedTableLabel(table.label).replace(/^টেবিল\s*/, "")}</p>
                    <p className={cx("text-[10px]", table.open_orders > 0 ? "text-clay-700" : "text-ink-400")}>
                      {table.open_orders > 0 ? formatNumber(table.open_orders) : t("orders.empty")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {tenant.isDemo ? (
        <Card className="border-ink-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-500">
              <FlaskConical className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-ink-800">{t("demo.title")}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">
                {t("demo.subtitle")}
              </p>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Dhaka" }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDayLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(parsed);
}
