import Link from "next/link";
import { Search, UserRound, Users } from "lucide-react";
import { Alert, Card, CardBody, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireTenant } from "@/lib/auth/server";
import { getCustomers } from "@/lib/services/staff";
import { formatDay, formatMoney, initials } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const tenant = await requireTenant(["owner", "manager"]);
  const params = await searchParams;

  let data;
  try {
    data = await getCustomers(tenant.user, tenant.restaurantId, params.q);
  } catch (error) {
    console.error("[customers] load failed", error);
    return (
      <div className="space-y-4">
        <PageHeader title="Customers" />
        <Alert tone="error" title="Guests could not be loaded">Refresh the page to try again.</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        description="Guests who left a name or phone number with an order. This list belongs only to your restaurant — it is never shared across tenants."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Known guests" value={data.summary.total} hint="Left contact details" icon={<Users className="size-4" aria-hidden />} />
        <Stat label="Repeat guests" value={data.summary.repeat} hint="More than one order" icon={<UserRound className="size-4" aria-hidden />} tone="moss" />
        <Stat label="Lifetime spend" value={formatMoney(data.summary.spend, tenant.currency)} hint="Across completed orders" tone="clay" />
      </div>

      <Card className="p-3">
        <form action="/dashboard/customers" method="get" className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Search by name, phone or email"
              aria-label="Search customers"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white pl-8 pr-3 text-[13px] focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
            />
          </div>
          <button type="submit" className="h-9 rounded-lg bg-ink-900 px-3 text-[12.5px] font-medium text-white hover:bg-ink-800">Search</button>
          {params.q ? (
            <Link href="/dashboard/customers" className="inline-flex h-9 items-center rounded-lg border border-ink-200 px-3 text-[12.5px] font-medium text-ink-700 hover:bg-ink-50">
              Clear
            </Link>
          ) : null}
        </form>
      </Card>

      {data.customers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="size-4" aria-hidden />}
            title={params.q ? "No guests match that search" : "No guest records yet"}
            description={
              params.q
                ? "Try a phone number or the name they used at the table."
                : "Guests appear here once they place an order and leave a name or phone number. Orders without details still reach your kitchen."
            }
          />
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-100">
              {data.customers.map((customer) => (
                <li key={customer.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-[12px] font-semibold text-ink-600">
                    {initials(customer.name ?? customer.phone ?? "?")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink-900">{customer.name ?? "Unnamed guest"}</p>
                    <p className="truncate text-[11.5px] text-ink-400">
                      {customer.phone ?? customer.email ?? "No contact details"}
                      {customer.first_order_at ? ` · first seen ${formatDay(customer.first_order_at)}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[12.5px] font-semibold tabular-nums text-ink-900">{formatMoney(customer.total_spend, tenant.currency)}</p>
                    <p className="text-[11px] text-ink-400">
                      {customer.total_orders} order{customer.total_orders === 1 ? "" : "s"}
                      {customer.last_order_at ? ` · ${formatDay(customer.last_order_at)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <p className="text-[11.5px] leading-relaxed text-ink-400">
        Only owners and managers can see this list. Guests' contact details are stored per restaurant and are excluded
        from any cross-tenant view, including the platform dashboard.
      </p>
    </div>
  );
}
