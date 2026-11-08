import Link from "next/link";
import { Compass, Menu } from "lucide-react";
import { LinkButton } from "@/components/ui";

export function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="MenuPilot home">
      <span className="grid size-8 place-items-center rounded-[10px] bg-clay-600 text-white shadow-sm">
        <Compass className="size-[18px]" strokeWidth={2.2} aria-hidden />
      </span>
      <span className={inverted ? "text-[15px] font-semibold tracking-tight text-white" : "text-[15px] font-semibold tracking-tight text-ink-900"}>
        MenuPilot
      </span>
    </Link>
  );
}

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
];

export function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-ink-50/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <BrandMark />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/menu/mati-kitchen"
            className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            Live menu demo
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <LinkButton href="/dashboard" size="sm">Open dashboard</LinkButton>
          ) : (
            <>
              <LinkButton href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                Sign in
              </LinkButton>
              <LinkButton href="/register" size="sm">Start free</LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <BrandMark />
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-ink-500">
            The operating system for independent restaurants: QR ordering, kitchen flow and the numbers that matter.
          </p>
        </div>
        <FooterColumn
          title="Product"
          links={[
            { href: "/features", label: "Features" },
            { href: "/pricing", label: "Pricing" },
            { href: "/menu/mati-kitchen", label: "Customer menu demo" },
          ]}
        />
        <FooterColumn
          title="Company"
          links={[
            { href: "/contact", label: "Contact" },
            { href: "/register", label: "Create an account" },
            { href: "/login", label: "Sign in" },
          ]}
        />
        <FooterColumn
          title="For your team"
          links={[
            { href: "/dashboard/kitchen", label: "Kitchen display" },
            { href: "/dashboard/analytics", label: "Analytics" },
            { href: "/platform", label: "Platform admin" },
          ]}
        />
      </div>
      <div className="border-t border-ink-100 px-5 py-5">
        <p className="mx-auto max-w-6xl text-[12px] text-ink-400">
          © {new Date().getFullYear()} MenuPilot. Built for restaurants that run on their feet.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-[13px] text-ink-600 transition-colors hover:text-clay-700">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MobileNavHint() {
  return (
    <details className="md:hidden">
      <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-ink-200 bg-white text-ink-600">
        <Menu className="size-4" aria-hidden />
        <span className="sr-only">Open navigation</span>
      </summary>
      <div className="absolute inset-x-0 top-16 border-b border-ink-200 bg-white px-5 py-3 shadow-sm">
        <ul className="space-y-1">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="block rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
