import { Star } from "lucide-react";
import { requireTenant } from "@/lib/auth/server";
import { getReviews } from "@/lib/services/reviews";
import { Alert, Card, PageHeader, Stat } from "@/components/ui";
import { ReviewManager, Stars } from "@/components/dashboard/review-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "মতামত" };

export default async function ReviewsPage() {
  const tenant = await requireTenant(["owner", "manager"]);

  let data;
  try {
    data = await getReviews(tenant.user, tenant.restaurantId);
  } catch (error) {
    console.error("[reviews] page load failed", error);
    data = null;
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Reviews" description="What guests said about their meals." />
        <Alert tone="error" title="Reviews could not load">
          The server did not return the review summary. Reload the page — if it persists, the detail is in the
          server logs.
        </Alert>
      </div>
    );
  }

  const r = data.restaurant;
  const rated = data.items.filter((item) => item.count > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reviews"
        description="Dish ratings and visit ratings from guests whose orders were served. Hiding a review never deletes it."
      />

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visit rating" value={r.count > 0 ? Number(r.average).toFixed(2) : "—"} hint={`${r.count} review${r.count === 1 ? "" : "s"}`} />
        <Stat label="5-star visits" value={r.five_star} hint={`${r.low_star} at 2 stars or below`} />
        <Stat label="Service" value={r.count > 0 ? Number(r.service).toFixed(1) : "—"} hint="Average out of 5" />
        <Stat label="Cleanliness" value={r.count > 0 ? Number(r.cleanliness).toFixed(1) : "—"} hint="Average out of 5" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-ink-900">Recent reviews</h2>
          <ReviewManager restaurantId={tenant.restaurantId} reviews={data.recent} />
        </section>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="text-[13px] font-semibold text-ink-900">Dish ratings</h2>
            {rated.length === 0 ? (
              <p className="mt-1 text-[12px] text-ink-500">No dish reviews yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {rated.map((item) => (
                  <li key={item.menu_item_id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[12px] text-ink-700">{item.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Stars value={item.average} size="sm" />
                      <span className="text-[11px] tabular-nums text-ink-500">
                        {Number(item.average).toFixed(1)} · {item.count}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
              <Star className="size-3.5 text-amber-500" aria-hidden /> How ratings are collected
            </h2>
            <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-ink-500">
              <li>Only guests whose order reached <strong className="text-ink-700">Served</strong> can review.</li>
              <li>One review per dish per order, and one visit review per order.</li>
              <li>A dish can only be rated if it was actually on that order.</li>
              <li>Hiding a review keeps the record; it only leaves public view.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
