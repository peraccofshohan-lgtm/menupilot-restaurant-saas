import { MenuWorkspace } from "@/components/dashboard/menu-workspace";
import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/lib/auth/server";
import { getMenu } from "@/lib/services/menu";

export const dynamic = "force-dynamic";
export const metadata = { title: "ক্যাটাগরি" };

export default async function CategoriesPage() {
  const tenant = await requireTenant(["owner", "manager"]);
  const data = await getMenu(tenant.user, tenant.restaurantId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Categories"
        description="How your menu is grouped for guests. Reorder them with the arrows; hidden categories disappear from the public menu."
      />
      <MenuWorkspace data={data} currency={tenant.currency} canEdit={tenant.role === "owner" || tenant.role === "manager"} />
    </div>
  );
}
