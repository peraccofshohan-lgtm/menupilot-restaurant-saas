import Link from "next/link";
import { ClipboardList, Search } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, OrderStatusBadge, PageHeader, cx } from "@/components/ui";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { requireTenant } from "@/lib/auth/server";
import { listOrders, ORDER_STATUSES, type OrderStatus } from "@/lib/services/orders";
import { formatDateTime, formatMoney, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

const FILTERS: { value: OrderStatus | "all" | "active"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "preparing", label: "Preparing" },
  { value: "ready", label: "Ready" },
  { value: "served", label: "Served" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All time" },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; from?: string; to?: string }>;
}) {
  const tenant = await requireTenant(["owner", "manager", "waiter", "kitchen"]);
  const params = await searchParams;

  const status = (FILTERS.find((f) => f.value === params.status)?.value ?? "active") as OrderStatus | "all" | "active";
  const page = Math.max(1, Number(params.page ?? 1));
  const pageSize = 25;

  const { orders, total } = await listOrders(tenant.user, tenant.restaurantId, {
    status,
    search: params.q,
    from: params.from,
    to: params.to,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <AutoRefresh intervalMs={15000} />
      <PageHeader
        title="Orders"
        description="Every guest order, from the first pending ticket to the served bill. Updates every 15 seconds."
        actions={
          <LinkButton href="/dashboard/kitchen" variant="secondary" size="sm">Kitchen display</LinkButton>
        }
      />

      <Card className="p-3">
        <form className="flex flex-col gap-2 sm:flex-row sm:items-center" action="/dashboard/orders" method="get">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Search order number, table, guest name or phone"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white pl-8 pr-3 text-[13px] text-ink-800 placeholder:text-ink-400 focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
              aria-label="Search orders"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              name="from"
              defaultValue={params.from ?? ""}
              aria-label="From date"
              className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-[12.5px] text-ink-700"
            />
            <input
              type="date"
              name="to"
              defaultValue={params.to ?? ""}
              aria-label="To date"
              className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-[12.5px] text-ink-700"
            />
            <input type="hidden" name="status" value={status} />
            <button type="submit" className="h-9 rounded-lg bg-ink-900 px-3 text-[12.5px] font-medium text-white hover:bg-ink-800">
              Filter
            </button>
          </div>
        </form>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {FILTERS.map((filter) => {
            const query = new URLSearchParams();
            query.set("status", filter.value);
            if (params.q) query.set("q", params.q);
            if (params.from) query.set("from", params.from);
            if (params.to) query.set("to", params.to);
            const active = filter.value === status;
            return (
              <Link
                key={filter.value}
                href={`/dashboard/orders?${query.toString()}`}
                className={cx(
                  "rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors",
                  active ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50",
                )}
                aria-current={active ? "page" : undefined}
              >
                {filter.label}
              </Link>
            );
          })}
          {pendingCount > 0 && status !== "pending" ? <Badge tone="amber">{pendingCount} pending on this page</Badge> : null}
        </div>
      </Card>

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="size-4" aria-hidden />}
            title={params.q ? "No orders match that search" : `No ${status === "all" ? "" : status === "active" ? "active " : `${status} `}orders`}
            description={
              params.q
                ? "Try a different order number, table or guest name."
                : "When guests order from a table QR code, their tickets land here first."
            }
            action={
              params.q ? (
                <LinkButton href="/dashboard/orders" variant="secondary" size="sm">Clear search</LinkButton>
              ) : (
                <LinkButton href="/dashboard/tables" size="sm">Open tables &amp; QR</LinkButton>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50/70 text-[11px] uppercase tracking-wider text-ink-500">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Order</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Table</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Guest</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Placed</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {orders.map((order) => (
                  <tr key={order.id} className="group hover:bg-ink-50/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/orders/${order.id}`} className="block">
                        <span className="text-[12.5px] font-semibold text-ink-900 group-hover:text-clay-700">
                          {order.order_number}
                        </span>
                        <span className="block text-[11px] text-ink-400">
                          {order.item_count} item{order.item_count === 1 ? "" : "s"}
                          {order.payment_status === "paid" ? " · paid" : ""}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] text-ink-700">{order.table_label ?? "Counter"}</td>
                    <td className="px-4 py-2.5 text-[12.5px] text-ink-600">
                      {order.customer_name ?? <span className="text-ink-400">Walk-in</span>}
                      {order.customer_phone ? <span className="block text-[11px] text-ink-400">{order.customer_phone}</span> : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block text-[12.5px] text-ink-700">{formatDateTime(order.created_at, tenant.timeZone)}</span>
                      <span className="text-[11px] text-ink-400">{timeAgo(order.created_at)}</span>
                    </td>
                    <td className="px-4 py-2.5"><OrderStatusBadge status={order.status} /></td>
                    <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold tabular-nums text-ink-900">
                      {formatMoney(order.total, order.currency || tenant.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-4 py-2.5">
            <p className="text-[12px] text-ink-500">
              {total} order{total === 1 ? "" : "s"} · page {page} of {totalPages}
            </p>
            <div className="flex gap-1.5">
              <PageLink disabled={page <= 1} page={page - 1} params={params} label="Previous" />
              <PageLink disabled={page >= totalPages} page={page + 1} params={params} label="Next" />
            </div>
          </div>
        </Card>
      )}
      <p className="text-[11.5px] text-ink-400">
        Statuses in this filter set: {ORDER_STATUSES.join(", ")}.
      </p>
    </div>
  );
}

function PageLink({
  disabled,
  page,
  params,
  label,
}: {
  disabled: boolean;
  page: number;
  params: { status?: string; q?: string; from?: string; to?: string };
  label: string;
}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.q) query.set("q", params.q);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  query.set("page", String(page));
  if (disabled) {
    return <span className="rounded-md border border-ink-200 px-2.5 py-1 text-[12px] text-ink-300">{label}</span>;
  }
  return (
    <Link href={`/dashboard/orders?${query.toString()}`} className="rounded-md border border-ink-200 bg-white px-2.5 py-1 text-[12px] font-medium text-ink-700 hover:bg-ink-50">
      {label}
    </Link>
  );
}
