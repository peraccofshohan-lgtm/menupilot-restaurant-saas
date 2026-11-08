import { Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth/server";
import { getPlatformOverview, getPlatformRestaurants } from "@/lib/services/platform";
import { formatMoney, formatNumber, percent } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

export default async function PlatformAnalyticsPage() {
  const user = await requireUser("/platform/analytics");
  const [overview, restaurants] = await Promise.all([getPlatformOverview(user), getPlatformRestaurants(user)]);

  const ranked = [...restaurants].sort((a, b) => Number(b.gmv_30d) - Number(a.gmv_30d));
  const totalGmv = ranked.reduce((sum, restaurant) => sum + Number(restaurant.gmv_30d), 0);
  const busiest = [...restaurants].sort((a, b) => b.orders_30d - a.orders_30d).slice(0, 5);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform analytics"
        description="Aggregate adoption and volume. Per-tenant reports live in each restaurant's own dashboard."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active tenants" value={formatNumber(overview.active_restaurants)} hint={`${overview.restaurants} total`} />
        <Stat label="Orders (30d)" value={formatNumber(overview.orders_30d)} hint="All tenants" tone="amber" />
        <Stat label="GMV (30d)" value={formatMoney(overview.gmv_30d, "BDT")} hint="Completed only" tone="moss" />
        <Stat
          label="Avg GMV / tenant"
          value={formatMoney(overview.active_restaurants > 0 ? Number(overview.gmv_30d) / overview.active_restaurants : 0, "BDT")}
          hint="Active tenants"
          tone="clay"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="GMV concentration" description="Share of platform volume by tenant (30 days)." />
          <CardBody className="space-y-2.5 pt-0">
            {ranked.map((restaurant) => (
              <div key={restaurant.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] text-ink-700">{restaurant.name}</span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-500">{formatMoney(restaurant.gmv_30d, restaurant.currency)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full rounded-full bg-clay-500" style={{ width: `${Math.max(3, percent(Number(restaurant.gmv_30d), totalGmv))}%` }} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Busiest tenants" description="Order volume in the last 30 days." />
          <CardBody className="pt-0">
            <ul className="divide-y divide-ink-100">
              {busiest.map((restaurant) => (
                <li key={restaurant.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink-800">{restaurant.name}</p>
                    <p className="text-[11px] text-ink-400">{restaurant.city ?? "—"} · {restaurant.tables} tables</p>
                  </div>
                  <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink-900">{restaurant.orders_30d}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
