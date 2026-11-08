import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Compass } from "lucide-react";
import { getCurrentUser, getMemberships } from "@/lib/auth/server";
import { LinkButton } from "@/components/ui";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "Set up your restaurant" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/onboarding");

  const memberships = await getMemberships(user);

  if (memberships.length > 0) {
    return (
      <main className="grid min-h-dvh place-items-center px-5 py-12">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-moss-50 text-moss-600">
            <CheckCircle2 className="size-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-ink-900">Your workspace is already open</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">
            {memberships.map((m) => m.restaurant_name).join(", ")} is connected to your account.
            {" "}Use &ldquo;Switch restaurant&rdquo; in the sidebar, or create an additional venue below.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <LinkButton href="/dashboard">Go to dashboard</LinkButton>
            <LinkButton href="/onboarding/new" variant="secondary">Add another restaurant</LinkButton>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-white">
      <header className="border-b border-ink-200">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-[10px] bg-clay-600 text-white">
              <Compass className="size-[18px]" strokeWidth={2.2} aria-hidden />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink-900">MenuPilot</span>
          </Link>
          <p className="text-[12px] text-ink-400">Signed in as {user.email}</p>
        </div>
      </header>
      <OnboardingWizard ownerName={user.fullName ?? user.email} />
    </main>
  );
}
