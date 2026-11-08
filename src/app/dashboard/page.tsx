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
  OrderStatusBadge,
  Stat,
  cx,
} from "@/components/ui";
import { LiveOrders } from "@/components/dashboard/live-orders";
import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/server";
import { getOverview } from "@/lib/services/overview";
import { formatMoney, formatNumber, timeAgo, percent } from "@/lib/format";

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

  const currency = tenant.currency;
  const today = overview.today;
  const isNew = Number(today.orders) === 0 && overview.menu_item_count === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">
              {greeting()}, {tenant.user.fullName?.split(" ")[0] ?? "there"}
            </h1>
            {tenant.isDemo ? <Badge tone="clay">Demo tenant</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] text-ink-500">
            {formatDayLabel(overview.business_date)} · {overview.time_zone}
            {overview.pending_orders > 0 ? (
              <span className="text-amber-700"> · {overview.pending_orders} order{overview.pending_orders === 1 ? "" : "s"} awaiting approval</span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/dashboard/kitchen" variant="secondary" size="sm">
            <ChefHat className="size-3.5" aria-hidden /> Kitchen display
          </LinkButton>
          <LinkButton href="/dashboard/tables" size="sm">
            <QrCode className="size-3.5" aria-hidden /> Tables &amp; QR
          </LinkButton>
        </div>
      </div>

      {params.denied ? (
        <div className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200" role="alert">
          Your role does not include access to {params.denied.split(",").join(" / ")}. Ask the owner if you need it.
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
                <p className="text-[14px] font-semibold text-ink-900">Your menu is empty — let's fix that first</p>
                <p className="mt-0.5 max-w-xl text-[12.5px] leading-relaxed text-ink-600">
                  Add your dishes with prices and photographs, then open the menu on your phone and place a test order
                  from a table QR to see the whole flow.
                </p>
              </div>
            </div>
            <LinkButton href="/dashboard/menu" size="sm">Add your first dish</LinkButton>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Today's orders"
          value={formatNumber(Number(today.orders))}
          hint={`${today.pending} pending · ${today.accepted} accepted`}
          icon={<ClipboardList className="size-4" aria-hidden />}
          tone="neutral"
        />
        <Stat
          label="Sales today"
          value={formatMoney(Number(today.revenue), currency)}
          hint="Ready + served orders only"
          icon={<Coins className="size-4" aria-hidden />}
          tone="moss"
        />
        <Stat
          label="Average order"
          value={formatMoney(Number(today.avg_order_value), currency)}
          hint={`${today.served} served today`}
          icon={<TrendingUp className="size-4" aria-hidden />}
          tone="clay"
        />
        <Stat
          label="In the kitchen now"
          value={formatNumber(overview.active_kitchen)}
          hint={`${today.ready} ready to run`}
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
            title="Recent activity"
            description="The last orders across every status."
            action={
              <Link href="/dashboard/orders" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-clay-700 hover:text-clay-800">
                All orders <ArrowRight className="size-3" aria-hidden />
              </Link>
            }
          />
          <CardBody className="pt-0">
            {overview.recent_orders.length === 0 ? (
              <EmptyState
                compact
                icon={<Clock3 className="size-4" aria-hidden />}
                title="No orders yet"
                description="Place a test order from a table QR to see the workflow end to end."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {overview.recent_orders.map((order) => (
                  <li key={order.id}>
                    <Link href={`/dashboard/orders/${order.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-ink-50/60">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-semibold text-ink-800">{order.table_label ?? "Counter"}</span>
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <p className="truncate text-[11.5px] text-ink-400">
                          {order.order_number} · {order.item_count} item{order.item_count === 1 ? "" : "s"} · {timeAgo(order.created_at)}
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
            title="Popular dishes"
            description="Ranked by quantity sold in the last 30 days."
            action={
              <Link href="/dashboard/analytics" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-clay-700 hover:text-clay-800">
                <BarChart3 className="size-3" aria-hidden /> Analytics
              </Link>
            }
          />
          <CardBody className="pt-0">
            {overview.popular_items.length === 0 ? (
              <EmptyState compact icon={<BarChart3 className="size-4" aria-hidden />} title="Not enough data yet" description="Popular dishes appear once you have accepted orders behind you." />
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
                          {item.quantity} sold · {formatMoney(item.revenue, currency)}
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
            title="Floor status"
            description={`${overview.table_count} active tables`}
            action={
              <Link href="/dashboard/tables" className="text-[12.5px] font-medium text-clay-700 hover:text-clay-800">
                Manage
              </Link>
            }
          />
          <CardBody className="pt-0">
            {overview.tables.length === 0 ? (
              <EmptyState compact icon={<QrCode className="size-4" aria-hidden />} title="No tables yet" description="Add tables to generate QR codes." />
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {overview.tables.map((table) => (
                  <div
                    key={table.id}
                    className={cx(
                      "rounded-lg border px-1.5 py-2 text-center",
                      table.open_orders > 0 ? "border-clay-200 bg-clay-50" : "border-ink-200 bg-white",
                    )}
                    title={`${table.label}${table.zone ? ` · ${table.zone}` : ""} — ${table.open_orders} open order(s)`}
                  >
                    <p className="text-[11.5px] font-semibold text-ink-800">{table.label.replace(/^Table\s*/i, "")}</p>
                    <p className={cx("text-[10px]", table.open_orders > 0 ? "text-clay-700" : "text-ink-400")}>
                      {table.open_orders > 0 ? `${table.open_orders} open` : "free"}
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
              <p className="text-[13px] font-semibold text-ink-800">You are inside the demo tenant</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">
                MATI Kitchen exists so you can explore the product with realistic data. Changes you make here stay in
                this tenant — no other restaurant can see them, and nothing is shared with newly registered accounts.
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
