import Link from "next/link";
import { ArrowRight, Building2, Coins, ShoppingBag, Users } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth/server";
import { getPlatformOverview, getPlatformRestaurants } from "@/lib/services/platform";
import { formatDay, formatMoney, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function PlatformHomePage() {
  const user = await requireUser("/platform");
  const [overview, restaurants] = await Promise.all([
    getPlatformOverview(user),
    getPlatformRestaurants(user),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform overview"
        description="Aggregate health across every tenant. Individual restaurant data stays inside its workspace."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Restaurants" value={formatNumber(overview.restaurants)} hint={`${overview.active_restaurants} active · ${overview.suspended_restaurants} suspended`} icon={<Building2 className="size-4" aria-hidden />} />
        <Stat label="Members" value={formatNumber(overview.users)} hint="Across all tenants" icon={<Users className="size-4" aria-hidden />} tone="blue" />
        <Stat label="Orders (30d)" value={formatNumber(overview.orders_30d)} hint={`${formatNumber(overview.orders)} lifetime`} icon={<ShoppingBag className="size-4" aria-hidden />} tone="amber" />
        <Stat label="GMV (30d)" value={formatMoney(overview.gmv_30d, "BDT")} hint="Completed orders only" icon={<Coins className="size-4" aria-hidden />} tone="moss" />
      </div>

      <Card>
        <CardHeader
          title="Restaurants"
          description="Account status and aggregate activity per tenant."
          action={<Link href="/platform/restaurants" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-clay-700 hover:text-clay-800">Manage <ArrowRight className="size-3" aria-hidden /></Link>}
        />
        <CardBody className="pt-0">
          {restaurants.length === 0 ? (
            <EmptyState title="No restaurants yet" description="Tenants appear here as soon as an owner completes onboarding." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
                    <th className="py-2 font-semibold">Restaurant</th>
                    <th className="py-2 font-semibold">Status</th>
                    <th className="py-2 font-semibold">Owner</th>
                    <th className="py-2 text-right font-semibold">Dishes</th>
                    <th className="py-2 text-right font-semibold">Tables</th>
                    <th className="py-2 text-right font-semibold">Orders 30d</th>
                    <th className="py-2 text-right font-semibold">GMV 30d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {restaurants.map((restaurant) => (
                    <tr key={restaurant.id}>
                      <td className="py-2.5">
                        <Link href={`/platform/restaurants?focus=${restaurant.id}`} className="font-medium text-ink-900 hover:text-clay-700">{restaurant.name}</Link>
                        <p className="text-[11px] text-ink-400">/{restaurant.slug} · joined {formatDay(restaurant.created_at)}</p>
                      </td>
                      <td className="py-2.5">
                        <Badge tone={restaurant.status === "active" ? "moss" : restaurant.status === "suspended" ? "red" : "amber"}>
                          {restaurant.status}
                        </Badge>
                        {restaurant.is_demo ? <Badge tone="clay" className="ml-1">demo</Badge> : null}
                      </td>
                      <td className="py-2.5 text-ink-600">{restaurant.owner_email ?? "—"}</td>
                      <td className="py-2.5 text-right tabular-nums text-ink-700">{restaurant.items}</td>
                      <td className="py-2.5 text-right tabular-nums text-ink-700">{restaurant.tables}</td>
                      <td className="py-2.5 text-right tabular-nums text-ink-700">{restaurant.orders_30d}</td>
                      <td className="py-2.5 text-right tabular-nums font-medium text-ink-900">{formatMoney(restaurant.gmv_30d, restaurant.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <p className="text-[11.5px] leading-relaxed text-ink-400">
        Platform administrators can view account status and aggregate figures. They cannot read a restaurant's guest
        contact details or individual order contents — those remain behind tenant RLS by design.
      </p>
    </div>
  );
}
