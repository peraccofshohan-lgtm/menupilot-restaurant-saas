import Link from "next/link";
import { ArrowLeft, ShieldCheck, TriangleAlert } from "lucide-react";

import { requireTenant } from "@/lib/auth/server";
import { previewDemoReset } from "@/lib/services/demo-reset";
import { ResetDemoForm } from "./reset-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo data" };

function Stat({ label, value, muted }: { label: string; value: number | string; muted?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${muted ? "text-ink-400" : "text-ink-900"}`}>
        {value}
      </p>
    </div>
  );
}

export default async function DemoDataPage() {
  const tenant = await requireTenant(["owner"]);
  const preview = await previewDemoReset(tenant.user.id, tenant.restaurantId);

  if (!preview.ok) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
          Demo data is unavailable right now. Nothing has been changed.
        </p>
      </div>
    );
  }

  const p = preview.preview;
  const isDemo = p.isDemo;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="size-3" aria-hidden /> Back to settings
      </Link>
      <h1 className="mt-1 text-lg font-semibold text-ink-900">Demo data</h1>
      <p className="text-[12.5px] text-ink-500">
        Clear the orders left over from a walkthrough so the next demo starts with a clean queue.
      </p>

      {!isDemo ? (
        <div className="mt-5 flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-amber-900">
            <strong>{p.restaurantName}</strong> is not flagged as a demo restaurant, so reset is
            disabled. This protects a live restaurant&apos;s order history from ever being cleared
            by accident. Nothing on this page can delete data for this tenant.
          </p>
        </div>
      ) : null}

      <h2 className="mt-6 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-400">
        Would be removed
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Orders" value={p.orders} />
        <Stat label="Line items" value={p.orderItems} />
        <Stat label="Status changes" value={p.statusHistory} />
        <Stat label="Guest records" value={p.customers} />
        <Stat label="Reviews" value={p.reviews} />
        <Stat label="Service requests" value={p.serviceRequests} />
      </div>

      <h2 className="mt-6 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-400">
        <ShieldCheck className="size-3.5" aria-hidden /> Never touched
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Dishes" value={p.protected.menuItems} muted />
        <Stat label="Categories" value={p.protected.categories} muted />
        <Stat label="Tables" value={p.protected.diningTables} muted />
        <Stat label="QR codes" value={p.protected.qrTokens} muted />
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
        The menu, categories, tables, QR tokens, restaurant settings and every login are outside the
        scope of this reset. The database statement that performs it cannot reach those tables.
      </p>

      {p.openOrders > 0 ? (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900">
          {p.openOrders} order{p.openOrders === 1 ? " is" : "s are"} still open (pending, accepted,
          preparing or ready). Resetting now removes them mid-service.
        </p>
      ) : null}

      <div className="mt-7 rounded-xl border border-ink-200 bg-white p-5">
        <h2 className="text-[13.5px] font-semibold text-ink-900">Reset demo orders</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
          This is permanent. Type <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11px]">RESET</code>{" "}
          to confirm. The counts above are checked again on the server — if a new order arrives in
          between, nothing is deleted and you will be asked to review.
        </p>
        <ResetDemoForm expectedOrders={p.orders} disabled={!isDemo || p.orders === 0} />
      </div>
    </div>
  );
}
