import type { Metadata } from "next";
import { Badge, Card, LinkButton } from "@/components/ui";
import {
  BarChart3, ChefHat, Clock3, Image, Lock, QrCode, Receipt, ScanLine, ShieldCheck, Smartphone, Users, UtensilsCrossed,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Features",
  description: "QR table ordering, order approvals, kitchen display, menu management, staff roles and analytics.",
};

const GROUPS = [
  {
    title: "Guest ordering",
    icon: Smartphone,
    items: [
      { icon: QrCode, title: "Secure table QR codes", body: "Each table carries a 192-bit token that resolves to your restaurant and table server-side. There is no editable table parameter to spoof." },
      { icon: ScanLine, title: "Mobile-first menu", body: "Photographs, categories, search, availability and per-dish notes. Built for one thumb at a table, not for a desktop browser." },
      { icon: Receipt, title: "Server-side pricing", body: "The browser sends dish ids and quantities; the database prices every line and computes tax and service charge itself." },
      { icon: Clock3, title: "Live order tracking", body: "A private, unguessable link shows the guest their order's real status without exposing any tenant data." },
    ],
  },
  {
    title: "Operations",
    icon: ChefHat,
    items: [
      { icon: ChefHat, title: "Approval before the kitchen", body: "Nothing is cooked until a manager accepts it. Rejections carry a reason the guest can see." },
      { icon: Clock3, title: "Kitchen display", body: "Three columns by state, large type, ticket age highlighting, and an audio cue when a new ticket lands." },
      { icon: UtensilsCrossed, title: "Menu control", body: "Categories, dishes, photographs, availability and display order — with safe handling for dishes already ordered." },
      { icon: BarChart3, title: "Analytics you can trust", body: "Revenue counts only completed orders, in your own time zone, with rejected and cancelled orders excluded." },
    ],
  },
  {
    title: "Platform & security",
    icon: ShieldCheck,
    items: [
      { icon: Lock, title: "Row Level Security", body: "Every tenant table is protected in PostgreSQL. A restaurant can only read its own rows — enforced on the server, not in the UI." },
      { icon: Users, title: "Real roles", body: "Owner, manager, kitchen and waiter. Permissions are checked again inside the database for every state change." },
      { icon: Image, title: "Per-tenant storage", body: "Menu images are scoped to a restaurant folder. Uploads are type- and size-checked before a byte is stored." },
      { icon: ShieldCheck, title: "Abuse protection", body: "Public ordering is rate limited per device, idempotent on retry, and validated against the live menu before an order exists." },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <Badge tone="clay">Product</Badge>
      <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-ink-900">
        A small, complete system — not a menu builder with a dashboard bolted on
      </h1>
      <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-600">
        MenuPilot covers the four moments that decide a service. Everything below is implemented in this product; where
        something is not, it is not shown.
      </p>

      <div className="mt-10 space-y-10">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-ink-900 text-white"><group.icon className="size-4" aria-hidden /></span>
              <h2 className="text-lg font-semibold text-ink-900">{group.title}</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {group.items.map((item) => (
                <Card key={item.title} className="p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-clay-50 text-clay-600 ring-1 ring-inset ring-clay-100">
                      <item.icon className="size-4" aria-hidden />
                    </span>
                    <div>
                      <h3 className="text-[14px] font-semibold text-ink-900">{item.title}</h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-500">{item.body}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Card className="mt-10 flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">See it with real data</h2>
          <p className="mt-1 text-[13px] text-ink-500">The MATI Kitchen demo tenant has 50 dishes, 20 QR tables and four weeks of order history.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/menu/mati-kitchen" variant="secondary">Open the guest menu</LinkButton>
          <LinkButton href="/register">Create your restaurant</LinkButton>
        </div>
      </Card>
    </div>
  );
}
