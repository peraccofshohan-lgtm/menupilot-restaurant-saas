import { KitchenBoard } from "@/components/kitchen/board";
import { requireTenant } from "@/lib/auth/server";
import { getKitchenFeed } from "@/lib/services/orders";
import { PageHeader, LinkButton, Alert } from "@/components/ui";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kitchen display" };

export default async function KitchenPage() {
  const tenant = await requireTenant(["owner", "manager", "kitchen", "waiter"]);

  let tickets;
  try {
    tickets = await getKitchenFeed(tenant.user, tenant.restaurantId);
  } catch (error) {
    console.error("[kitchen] page feed failed", error);
    tickets = null;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kitchen display"
        description="Only orders you have approved reach this screen. Pending approvals stay on the orders board."
        actions={
          (tenant.role === "owner" || tenant.role === "manager") ? (
            <LinkButton href="/dashboard/orders?status=pending" variant="secondary" size="sm">
              <ExternalLink className="size-3.5" aria-hidden /> Review pending orders
            </LinkButton>
          ) : null
        }
      />

      {tickets === null ? (
        <Alert tone="error" title="The kitchen feed could not load">
          The server did not return today's tickets. This screen will retry automatically — if it persists, the
          technical detail is in the server logs.
        </Alert>
      ) : (
        <KitchenBoard
          restaurantId={tenant.restaurantId}
          restaurantName={tenant.restaurantName}
          role={tenant.role}
          initialTickets={tickets}
        />
      )}
    </div>
  );
}
