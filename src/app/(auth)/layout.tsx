import Link from "next/link";
import { Compass } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/" className="inline-flex w-fit items-center gap-2.5" aria-label="MenuPilot home">
          <span className="grid size-8 place-items-center rounded-[10px] bg-clay-600 text-white shadow-sm">
            <Compass className="size-[18px]" strokeWidth={2.2} aria-hidden />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink-900">MenuPilot</span>
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-[11.5px] text-ink-400">
          Need help? <Link href="/contact" className="text-clay-700 hover:underline">Contact support</Link>
        </p>
      </div>

      <aside className="hidden border-l border-ink-200 bg-ink-900 p-12 lg:flex lg:flex-col lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-clay-300">One platform</p>
          <h2 className="mt-4 max-w-sm font-display text-[1.75rem] leading-snug text-white">
            Four screens, one source of truth: the guest, the floor, the kitchen and the owner.
          </h2>
        </div>
        <dl className="space-y-5">
          {[
            { term: "Guest", detail: "Scans a table, orders from a live menu, follows the ticket without an account." },
            { term: "Floor", detail: "Approves or rejects each order before it reaches the kitchen." },
            { term: "Kitchen", detail: "Sees only accepted tickets, with quantities and dish-level notes." },
            { term: "Owner", detail: "Menu, tables, staff and revenue that counts only what you served." },
          ].map((row) => (
            <div key={row.term} className="border-l border-ink-700 pl-4">
              <dt className="text-[12px] font-semibold uppercase tracking-wider text-clay-300">{row.term}</dt>
              <dd className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-300">{row.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11.5px] text-ink-500">
          Tenant data is isolated with PostgreSQL Row Level Security, enforced on the server for every request.
        </p>
      </aside>
    </div>
  );
}
