import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ChefHat,
  Check,
  Clock3,
  CreditCard,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge, Card, LinkButton } from "@/components/ui";
import { formatMoney } from "@/lib/format";

export const metadata = {
  title: "MenuPilot — QR ordering and kitchen flow for restaurants",
  description:
    "Guests scan a table QR, order from a live menu, and your team approves each order before the kitchen sees it. Real-time kitchen display, staff roles and honest analytics.",
};

const FEATURES = [
  {
    icon: QrCode,
    title: "QR ordering that cannot be spoofed",
    body: "Every table gets a cryptographic token. Guests land on your menu with the right table attached — no editable ?table=1 in the URL.",
  },
  {
    icon: Check,
    title: "Nothing reaches the kitchen unapproved",
    body: "New orders arrive as pending. A manager accepts or rejects, and only approved tickets appear on the kitchen display.",
  },
  {
    icon: ChefHat,
    title: "A kitchen screen built for a wall",
    body: "Large, glanceable tickets with quantities and dish notes. Start preparation, mark ready, move on.",
  },
  {
    icon: BarChart3,
    title: "Numbers that match the till",
    body: "Revenue counts only orders you actually served. Business days follow your restaurant's own time zone.",
  },
  {
    icon: Users,
    title: "Roles that actually restrict",
    body: "Owners, managers, kitchen and waiters. Permissions are enforced in the database, not just hidden in the sidebar.",
  },
  {
    icon: ShieldCheck,
    title: "Tenants that cannot see each other",
    body: "Row Level Security on every tenant table. A restaurant can only ever read its own orders, menu, tables and staff.",
  },
];

const WORKFLOW = [
  { step: "01", title: "Guest scans the table QR", body: "The token resolves to your restaurant and table. The menu is read-only until an order is placed." },
  { step: "02", title: "Order lands as pending", body: "Prices, availability and totals are recalculated on the server. The browser can never set its own price." },
  { step: "03", title: "You approve it", body: "One tap accepts the order, or rejects it with a reason. The guest sees the decision on their tracking page." },
  { step: "04", title: "Kitchen takes over", body: "Accepted tickets appear instantly on the kitchen display. Preparing → ready → served, with a full audit trail." },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="border-b border-ink-200 bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div>
            <Badge tone="clay" dot>
              Built for independent restaurants
            </Badge>
            <h1 className="mt-4 text-[2.1rem] font-semibold leading-[1.1] tracking-tight text-ink-900 sm:text-[2.9rem]">
              Your menu, your kitchen, your numbers — finally in one place.
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-600">
              MenuPilot runs table ordering on top of the restaurant you already have. Guests order from a QR code,
              your team approves every order before the kitchen sees it, and the day's numbers are already waiting
              when you close.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <LinkButton href="/register" size="lg">
                Create your restaurant
                <ArrowRight className="size-4" aria-hidden />
              </LinkButton>
              <LinkButton href="/menu/mati-kitchen" variant="secondary" size="lg">
                <Smartphone className="size-4" aria-hidden />
                Try the guest menu
              </LinkButton>
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4 border-t border-ink-100 pt-6">
              {[
                { label: "Setup to first order", value: "Under 10 min" },
                { label: "Dishes on the demo menu", value: "50" },
                { label: "Table QR codes", value: "20" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dd className="text-lg font-semibold text-ink-900">{stat.value}</dd>
                  <dt className="mt-0.5 text-[12px] leading-snug text-ink-500">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50 px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-ink-300" />
                  <span className="size-2 rounded-full bg-ink-200" />
                  <span className="size-2 rounded-full bg-ink-200" />
                </div>
                <span className="text-[11px] font-medium text-ink-400">dashboard · incoming orders</span>
              </div>
              <div className="space-y-2.5 p-4">
                <OrderRow table="Table 07" items="2 × Mutton Kacchi, 1 × Lassi" amount={1360} status="pending" minutes="just now" />
                <OrderRow table="Table 12" items="1 × Beef Burger, 2 × Lemonade" amount={800} status="accepted" minutes="2 min ago" />
                <OrderRow table="Table 03" items="3 × Chicken Korma, 3 × Rice" amount={1920} status="preparing" minutes="9 min ago" />
                <OrderRow table="Table 18" items="1 × Lava Cake, 1 × Cold Brew" amount={540} status="ready" minutes="14 min ago" />
              </div>
              <div className="grid grid-cols-3 divide-x divide-ink-100 border-t border-ink-100">
                {[
                  { label: "Today", value: formatMoney(48260) },
                  { label: "Pending", value: "3" },
                  { label: "Avg order", value: formatMoney(612) },
                ].map((cell) => (
                  <div key={cell.label} className="px-4 py-3">
                    <p className="text-[11px] text-ink-400">{cell.label}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink-900">{cell.value}</p>
                  </div>
                ))}
              </div>
            </Card>
            <p className="mt-2.5 text-center text-[11px] text-ink-400">
              Illustrative preview. Your dashboard shows your own live data.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
            Everything a busy floor needs, nothing it does not
          </h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-600">
            No bloated ERP. MenuPilot covers the four moments that decide a service: ordering, approval,
            preparation and the numbers afterwards.
          </p>
        </div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="p-5">
              <span className="grid size-9 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-inset ring-clay-100">
                <feature.icon className="size-[18px]" aria-hidden />
              </span>
              <h3 className="mt-3.5 text-[14.5px] font-semibold text-ink-900">{feature.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{feature.body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Workflow */}
      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">One order, four moments</h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-600">
                The approval step is deliberate. It is what separates a QR menu from a working kitchen.
              </p>
            </div>
            <Link href="/features" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-clay-700 hover:text-clay-800">
              See every feature
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          <ol className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW.map((item) => (
              <li key={item.step} className="rounded-[var(--radius-card)] border border-ink-200 bg-ink-50/60 p-5">
                <span className="font-display text-sm font-semibold text-clay-600">{item.step}</span>
                <h3 className="mt-2 text-[14.5px] font-semibold text-ink-900">{item.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Priced per restaurant, not per head</h2>
            <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-ink-600">
              Every plan includes unlimited menu items, unlimited QR tables, the kitchen display and full analytics.
              Card payments for guests are not part of this release — the guest pays at the counter, exactly as your
              floor already works.
            </p>
            <div className="mt-6 flex flex-wrap gap-4 text-[13px] text-ink-600">
              <span className="inline-flex items-center gap-1.5"><Check className="size-4 text-moss-600" aria-hidden /> No card required</span>
              <span className="inline-flex items-center gap-1.5"><Clock3 className="size-4 text-moss-600" aria-hidden /> Live in minutes</span>
              <span className="inline-flex items-center gap-1.5"><CreditCard className="size-4 text-moss-600" aria-hidden /> Pay by invoice</span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="flex flex-col p-5">
              <p className="text-[13px] font-semibold text-ink-900">Table</p>
              <p className="mt-1 text-[12.5px] text-ink-500">For one venue, one team.</p>
              <p className="mt-4 text-2xl font-semibold text-ink-900">
                {formatMoney(2500)}<span className="text-[13px] font-normal text-ink-500"> /month</span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-[12.5px] text-ink-600">
                {["50 menu items", "20 QR tables", "Kitchen display", "Owner + 3 staff accounts"].map((line) => (
                  <li key={line} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-moss-600" aria-hidden />{line}</li>
                ))}
              </ul>
              <LinkButton href="/pricing" variant="secondary" className="mt-5" fullWidth>Compare plans</LinkButton>
            </Card>
            <Card className="flex flex-col border-clay-200 bg-clay-50/40 p-5">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-ink-900">Kitchen</p>
                <Badge tone="clay"><Sparkles className="size-3" aria-hidden /> Chains</Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-500">Multi-branch operations.</p>
              <p className="mt-4 text-2xl font-semibold text-ink-900">
                {formatMoney(6900)}<span className="text-[13px] font-normal text-ink-500"> /month</span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-[12.5px] text-ink-600">
                {["Unlimited dishes", "Unlimited tables", "Per-branch analytics", "Priority support"].map((line) => (
                  <li key={line} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-moss-600" aria-hidden />{line}</li>
                ))}
              </ul>
              <LinkButton href="/pricing" className="mt-5" fullWidth>See what is included</LinkButton>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-ink-200 bg-ink-900">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-14 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Open your workspace tonight</h2>
            <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-300">
              Create an account, add your dishes, generate QR codes for your tables. Nothing to install, nothing to
              configure on your POS.
            </p>
          </div>
          <div className="flex gap-2">
            <LinkButton href="/register" size="lg">Start free</LinkButton>
            <LinkButton href="/contact" variant="secondary" size="lg">Talk to us</LinkButton>
          </div>
        </div>
      </section>
    </>
  );
}

function OrderRow({
  table,
  items,
  amount,
  status,
  minutes,
}: {
  table: string;
  items: string;
  amount: number;
  status: "pending" | "accepted" | "preparing" | "ready";
  minutes: string;
}) {
  const tone = {
    pending: "bg-amber-50 text-amber-700 ring-amber-200",
    accepted: "bg-sky-50 text-sky-700 ring-sky-200",
    preparing: "bg-clay-50 text-clay-700 ring-clay-200",
    ready: "bg-violet-50 text-violet-700 ring-violet-200",
  }[status];
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[12.5px] font-semibold text-ink-800">{table}</p>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tone}`}>{status}</span>
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-ink-500">{items}</p>
      </div>
      <div className="text-right">
        <p className="text-[12.5px] font-semibold tabular-nums text-ink-900">{formatMoney(amount)}</p>
        <p className="text-[10.5px] text-ink-400">{minutes}</p>
      </div>
    </div>
  );
}
