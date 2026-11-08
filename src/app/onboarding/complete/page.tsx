import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, QrCode, UtensilsCrossed } from "lucide-react";
import { getCurrentUser, getTenantContext } from "@/lib/auth/server";
import { Card, LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Workspace ready" };
export const dynamic = "force-dynamic";

export default async function OnboardingCompletePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();
  if (!tenant) redirect("/onboarding");

  return (
    <main className="grid min-h-dvh place-items-center bg-ink-50 px-5 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-moss-50 text-moss-600">
            <CheckCircle2 className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-ink-900">{tenant.restaurantName} is live</h1>
            <p className="text-[12.5px] text-ink-500">Isolated workspace created with your own menu and QR codes.</p>
          </div>
        </div>

        <Card className="divide-y divide-ink-100">
          <div className="flex items-start gap-3 p-4">
            <UtensilsCrossed className="mt-0.5 size-4 shrink-0 text-clay-600" aria-hidden />
            <div>
              <p className="text-[13px] font-medium text-ink-800">Add your first dishes</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">
                Four starter categories are ready. Add dishes with prices and photographs.
              </p>
              <Link href="/dashboard/menu" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-clay-700 hover:underline">
                Open menu manager <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4">
            <QrCode className="mt-0.5 size-4 shrink-0 text-clay-600" aria-hidden />
            <div>
              <p className="text-[13px] font-medium text-ink-800">Print your table QR codes</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">
                Each table has a secure token. Download or print the sheet and put one on every table.
              </p>
              <Link href="/dashboard/tables" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-clay-700 hover:underline">
                Open tables &amp; QR <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-clay-600" aria-hidden />
            <div>
              <p className="text-[13px] font-medium text-ink-800">Configure money and hours</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">
                Tax, service charge, operating hours and whether orders need your approval.
              </p>
              <Link href="/dashboard/settings" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-clay-700 hover:underline">
                Open settings <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
          </div>
        </Card>

        <div className="mt-5 flex gap-2">
          <LinkButton href="/dashboard" size="lg" fullWidth>
            Go to dashboard <ArrowRight className="size-4" aria-hidden />
          </LinkButton>
          <LinkButton href={`/menu/${tenant.restaurantSlug}`} variant="secondary" size="lg">
            Preview menu
          </LinkButton>
        </div>
      </div>
    </main>
  );
}
