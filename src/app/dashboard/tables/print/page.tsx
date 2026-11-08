import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/auth/server";
import { buildQrSvg, getTables } from "@/lib/services/tables";
import { serverEnv } from "@/lib/env";
import { PrintTrigger } from "./print-trigger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Print QR sheet" };

export default async function PrintSheetPage() {
  const tenant = await requireTenant(["owner", "manager"]);
  const tables = await getTables(tenant.user, tenant.restaurantId);
  const origin = serverEnv.appUrl.replace(/\/$/, "");

  const cards = await Promise.all(
    tables
      .filter((table) => table.qr_token && table.is_active)
      .map(async (table) => ({
        ...table,
        svg: await buildQrSvg(`${origin}/q/${table.qr_token}`, 260),
        url: `${origin}/q/${table.qr_token}`,
      })),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:p-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/dashboard/tables" className="inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-800">
            <ArrowLeft className="size-3" aria-hidden /> Back to tables
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-ink-900">QR sheet · {tenant.restaurantName}</h1>
          <p className="text-[12.5px] text-ink-500">
            {cards.length} active table{cards.length === 1 ? "" : "s"}. Four per page, cut along the dashed lines.
          </p>
        </div>
        <PrintTrigger />
      </div>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-300 p-8 text-center text-[13px] text-ink-500">
          No active tables with QR codes yet. Add a table first.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 print:grid-cols-2 print:gap-2">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex break-inside-avoid flex-col items-center rounded-xl border border-dashed border-ink-300 bg-white p-5 text-center print:rounded-none"
            >
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-clay-600">Scan to order</p>
              <div className="mt-2 size-40 [&>svg]:size-full" aria-hidden dangerouslySetInnerHTML={{ __html: card.svg }} />
              <p className="mt-2 text-[15px] font-semibold text-ink-900">{card.label}</p>
              <p className="text-[11px] text-ink-500">{tenant.restaurantName}</p>
              {card.zone ? <p className="text-[10px] text-ink-400">{card.zone}</p> : null}
              <p className="mt-1.5 max-w-full break-all font-mono text-[8px] leading-tight text-ink-300">{card.url}</p>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @media print {
          body { background: white !important; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}
