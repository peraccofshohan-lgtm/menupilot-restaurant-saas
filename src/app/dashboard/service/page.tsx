import { requireTenant } from "@/lib/auth/server";
import { getServiceBoard } from "@/lib/services/reviews";
import { Alert, PageHeader } from "@/components/ui";
import { ServiceBoard } from "@/components/dashboard/service-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "সার্ভিস অনুরোধ" };

export default async function ServicePage() {
  const tenant = await requireTenant(["owner", "manager", "waiter", "kitchen"]);

  let requests;
  try {
    requests = await getServiceBoard(tenant.user, tenant.restaurantId);
  } catch (error) {
    console.error("[service] page load failed", error);
    requests = null;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Service requests"
        description="What guests have asked for from their tables. Refreshes every ten seconds — this is polling, not a live socket."
      />
      {requests === null ? (
        <Alert tone="error" title="The service board could not load">
          The server did not return today&apos;s requests. Reload the page — if it persists, the detail is in the
          server logs.
        </Alert>
      ) : (
        <ServiceBoard restaurantId={tenant.restaurantId} initial={requests} />
      )}
    </div>
  );
}
