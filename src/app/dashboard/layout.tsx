import { redirect } from "next/navigation";
import { getTenantContext, getCurrentUser, isPlatformAdmin } from "@/lib/auth/server";
import { DashboardShell } from "@/components/dashboard/shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  const tenant = await getTenantContext();
  if (!tenant) redirect("/onboarding");

  const admin = await isPlatformAdmin(user);

  return (
    <DashboardShell tenant={tenant} isAdmin={admin}>
      {children}
    </DashboardShell>
  );
}
