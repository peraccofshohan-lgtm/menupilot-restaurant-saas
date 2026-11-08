import { Alert, LinkButton, PageHeader } from "@/components/ui";
import { MenuWorkspace } from "@/components/dashboard/menu-workspace";
import { requireTenant } from "@/lib/auth/server";
import { getMenu } from "@/lib/services/menu";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "মেনু" };

export default async function MenuPage() {
  const tenant = await requireTenant(["owner", "manager"]);

  let data;
  try {
    data = await getMenu(tenant.user, tenant.restaurantId);
  } catch (error) {
    console.error("[menu] load failed", error);
    return (
      <div className="space-y-4">
        <PageHeader title="Menu" />
        <Alert tone="error" title="Your menu could not be loaded">
          The database did not return your dishes. Refresh the page; if it persists the technical detail is in the
          server logs.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Menu"
        description="Dishes, prices, photographs and availability. Guests see changes the moment you save."
        actions={
          <LinkButton href={`/menu/${tenant.restaurantSlug}`} variant="secondary" size="sm" target="_blank">
            <ExternalLink className="size-3.5" aria-hidden /> Preview guest menu
          </LinkButton>
        }
      />
      <MenuWorkspace data={data} currency={tenant.currency} canEdit={tenant.role === "owner" || tenant.role === "manager"} />
    </div>
  );
}
