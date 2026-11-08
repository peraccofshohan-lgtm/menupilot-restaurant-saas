import Link from "next/link";
import { redirect } from "next/navigation";
import { Compass } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/server";
import { requirePlatformAdmin } from "@/lib/services/platform";
import { logoutAction } from "@/lib/actions/auth";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Platform", template: "%s · MenuPilot Platform" } };

const NAV = [
  { href: "/platform", label: "Overview" },
  { href: "/platform/restaurants", label: "Restaurants" },
  { href: "/platform/users", label: "Users" },
  { href: "/platform/analytics", label: "Analytics" },
  { href: "/platform/settings", label: "Settings" },
];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/platform");

  // A layout cannot stop its page from running, so the guard has to redirect:
  // rendering a gate while the page still executes would run tenant queries for
  // an account that has no business running them.
  const admin = await requirePlatformAdmin(user);
  if (!admin) redirect("/dashboard");

  return (
    <div className="min-h-dvh bg-ink-50">
      <header className="border-b border-ink-200 bg-ink-900">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-clay-500 text-white">
              <Compass className="size-4" aria-hidden />
            </span>
            <span className="text-[13px] font-semibold text-white">MenuPilot</span>
            <Badge tone="clay">Platform</Badge>
          </div>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Platform">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-ink-300 hover:bg-white/10 hover:text-white">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-[12px] text-ink-300 hover:text-white">Restaurant view</Link>
            <form action={logoutAction}>
              <button type="submit" className="text-[12px] font-medium text-ink-300 hover:text-white">Sign out</button>
            </form>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-white/10 px-4 py-1.5 sm:hidden" aria-label="Platform mobile">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap rounded-md px-2 py-1 text-[12px] text-ink-300 hover:bg-white/10">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
