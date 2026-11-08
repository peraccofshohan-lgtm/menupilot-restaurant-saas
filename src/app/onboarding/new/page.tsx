import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/server";
import { OnboardingWizard } from "../wizard";
import { LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Add a restaurant" };
export const dynamic = "force-dynamic";

export default async function NewRestaurantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/onboarding/new");

  return (
    <main className="min-h-dvh bg-ink-50 px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Add another restaurant</h1>
            <p className="mt-1 text-[13px] text-ink-500">
              Each restaurant is a separate tenant with its own menu, tables, orders and staff.
            </p>
          </div>
          <LinkButton href="/dashboard" variant="secondary" size="sm">Cancel</LinkButton>
        </div>
        <OnboardingWizard ownerName={user.fullName ?? user.email} compact />
      </div>
    </main>
  );
}
