import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import { Badge, Card, LinkButton } from "@/components/ui";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = {
  title: "Pricing",
  description: "One price per restaurant. Every plan includes QR ordering, the kitchen display and full analytics.",
};

interface Plan {
  name: string;
  price: number;
  blurb: string;
  features: ReadonlyArray<readonly [string, string | boolean]>;
  cta: string;
  href: string;
  highlight: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Table",
    price: 2500,
    blurb: "One venue, one team, everything you need to run a service.",
    features: [
      ["Menu items", "Up to 50"],
      ["QR tables", "Up to 20"],
      ["Kitchen display", true],
      ["Order approvals", true],
      ["Staff accounts", "Owner + 3"],
      ["Analytics", "30-day window"],
      ["Guest customer list", true],
    ],
    cta: "Start free",
    href: "/register",
    highlight: false,
  } as Plan,
  {
    name: "Kitchen",
    price: 6900,
    blurb: "For multi-branch operators who need per-branch reporting.",
    features: [
      ["Menu items", "Unlimited"],
      ["QR tables", "Unlimited"],
      ["Kitchen display", true],
      ["Order approvals", true],
      ["Staff accounts", "Unlimited"],
      ["Analytics", "Full history"],
      ["Guest customer list", true],
    ],
    cta: "Start free",
    href: "/register",
    highlight: true,
  } as Plan,
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <Badge tone="clay">Pricing</Badge>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">One price per restaurant</h1>
      <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-600">
        No commission on orders, no per-head charges, no payment processing in this release. Guests settle at the
        counter exactly as they do today.
      </p>

      <div className="mt-9 grid gap-4 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <Card key={plan.name} className={plan.highlight ? "border-clay-300 p-6" : "p-6"}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-ink-900">{plan.name}</h2>
              {plan.highlight ? <Badge tone="clay">Most popular</Badge> : null}
            </div>
            <p className="mt-1 text-[13px] text-ink-500">{plan.blurb}</p>
            <p className="mt-5 text-3xl font-semibold tracking-tight text-ink-900">
              {formatMoney(plan.price)}
              <span className="text-[13px] font-normal text-ink-500"> /month</span>
            </p>
            <dl className="mt-5 space-y-2">
              {plan.features.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <dt className="text-ink-500">{label}</dt>
                  <dd className="font-medium text-ink-800">
                    {value === true ? <Check className="size-4 text-moss-600" aria-label="included" /> : value === false ? <X className="size-4 text-ink-300" aria-label="not included" /> : value}
                  </dd>
                </div>
              ))}
            </dl>
            <LinkButton href={plan.href} variant={plan.highlight ? "primary" : "secondary"} className="mt-6" fullWidth>
              {plan.cta}
            </LinkButton>
          </Card>
        ))}
      </div>

      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        {[
          ["No card required", "Create a workspace and take a test order before you commit to anything."],
          ["Cancel anytime", "Your data stays exportable. We do not hold your menu hostage."],
          ["Honest limits", "If a plan limit exists, the product tells you before you hit it — no surprise invoices."],
        ].map(([title, body]) => (
          <Card key={title} className="p-4">
            <p className="text-[13px] font-semibold text-ink-900">{title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{body}</p>
          </Card>
        ))}
      </div>

      <p className="mt-8 rounded-lg bg-white px-4 py-3 text-[12px] leading-relaxed text-ink-500 ring-1 ring-inset ring-ink-200">
        Prices are illustrative for this demonstration build and shown in BDT. A production deployment would bill
        through a payment provider; no billing integration is wired into this version, and no plan limits are enforced
        in the database yet.
      </p>
    </div>
  );
}
