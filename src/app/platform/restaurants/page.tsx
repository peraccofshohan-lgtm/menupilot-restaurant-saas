import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { RestaurantStatusControl } from "@/components/platform/status-control";
import { requireUser } from "@/lib/auth/server";
import { getPlatformRestaurants } from "@/lib/services/platform";
import { formatDay, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Restaurants" };

export default async function PlatformRestaurantsPage() {
  const user = await requireUser("/platform/restaurants");
  const restaurants = await getPlatformRestaurants(user);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Restaurants"
        description="Activate or suspend tenant accounts. Suspending blocks guest QR access immediately; the owner can still sign in and see why."
      />
      <Card>
        <CardHeader title={`${restaurants.length} tenants`} description="Demo tenants are protected from suspension." />
        <CardBody className="pt-0">
          <ul className="divide-y divide-ink-100">
            {restaurants.map((restaurant) => (
              <li key={restaurant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[13px] font-semibold text-ink-900">{restaurant.name}</p>
                    <Badge tone={restaurant.status === "active" ? "moss" : restaurant.status === "suspended" ? "red" : "amber"}>{restaurant.status}</Badge>
                    {restaurant.is_demo ? <Badge tone="clay">demo</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-ink-400">
                    /{restaurant.slug} · {restaurant.owner_email ?? "no owner"} · {restaurant.members} members ·{" "}
                    {restaurant.items} dishes · {restaurant.tables} tables · joined {formatDay(restaurant.created_at)}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink-500">
                    Last 30 days: {restaurant.orders_30d} orders · {formatMoney(restaurant.gmv_30d, restaurant.currency)} GMV
                  </p>
                </div>
                <RestaurantStatusControl
                  restaurantId={restaurant.id}
                  status={restaurant.status}
                  isDemo={restaurant.is_demo}
                />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
