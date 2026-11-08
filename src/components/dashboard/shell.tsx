"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BellRing, ChefHat, ChevronsUpDown, ExternalLink, LayoutDashboard, LogOut, Menu as MenuIcon, QrCode, ReceiptText, RotateCcw, Settings, Shield, Star, Store, Users, UtensilsCrossed, X } from "lucide-react";
import { cx } from "@/components/ui";
import type { TenantContext, TenantRole } from "@/lib/auth/server";
import { logoutAction, switchRestaurantAction } from "@/lib/actions/auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  roles: TenantRole[];
  exact?: boolean;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operations",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard, roles: ["owner", "manager", "kitchen", "waiter"], exact: true },
      { href: "/dashboard/orders", label: "Orders", icon: ReceiptText, roles: ["owner", "manager", "waiter"] },
      { href: "/dashboard/kitchen", label: "Kitchen display", icon: ChefHat, roles: ["owner", "manager", "kitchen", "waiter"] },
      { href: "/dashboard/service", label: "Service requests", icon: BellRing, roles: ["owner", "manager", "kitchen", "waiter"] },
      { href: "/dashboard/tables", label: "Tables & QR", icon: QrCode, roles: ["owner", "manager"] },
    ],
  },
  {
    label: "Restaurant",
    items: [
      { href: "/dashboard/menu", label: "Menu", icon: UtensilsCrossed, roles: ["owner", "manager"] },
      { href: "/dashboard/categories", label: "Categories", icon: MenuIcon, roles: ["owner", "manager"] },
      { href: "/dashboard/customers", label: "Customers", icon: Users, roles: ["owner", "manager"] },
      { href: "/dashboard/reviews", label: "Reviews", icon: Star, roles: ["owner", "manager"] },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, roles: ["owner", "manager"] },
      { href: "/dashboard/staff", label: "Staff", icon: Shield, roles: ["owner"] },
      { href: "/dashboard/settings", label: "Settings", icon: Settings, roles: ["owner", "manager"] },
      { href: "/dashboard/demo", label: "Demo data", icon: RotateCcw, roles: ["owner"] },
    ],
  },
];

const ROLE_LABEL: Record<TenantRole, string> = {
  owner: "Owner",
  manager: "Manager",
  kitchen: "Kitchen",
  waiter: "Waiter",
};

export function DashboardShell({
  tenant,
  isAdmin,
  children,
}: {
  tenant: TenantContext;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const [switching, setSwitching] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMobileOpen(false);
    setSwitcherOpen(false);
  }, [pathname]);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(tenant.role)),
  })).filter((group) => group.items.length > 0);

  async function handleSwitch(id: string) {
    setSwitching(id);
    const result = await switchRestaurantAction(id);
    if (result.status === "success") window.location.href = "/dashboard";
    else setSwitching(null);
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-16 items-center justify-between gap-2 border-b border-ink-200 px-4">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-clay-600 text-white">
            <Store className="size-[17px]" strokeWidth={2.2} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold leading-tight text-ink-900">{tenant.restaurantName}</span>
            <span className="block text-[11px] leading-tight text-ink-400">{ROLE_LABEL[tenant.role]} workspace</span>
          </span>
        </Link>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {tenant.memberships.length > 1 ? (
        <div className="border-b border-ink-100 p-2">
          <button
            type="button"
            onClick={() => setSwitcherOpen((open) => !open)}
            aria-expanded={switcherOpen}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-ink-600 hover:bg-ink-50"
          >
            <span className="flex items-center gap-2"><ChevronsUpDown className="size-3.5" aria-hidden /> Switch restaurant</span>
            <span className="text-[11px] text-ink-400">{tenant.memberships.length}</span>
          </button>
          {switcherOpen ? (
            <ul className="mt-1 space-y-0.5">
              {tenant.memberships.map((membership) => (
                <li key={membership.restaurant_id}>
                  <button
                    type="button"
                    disabled={switching !== null}
                    onClick={() => handleSwitch(membership.restaurant_id)}
                    className={cx(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-ink-50",
                      membership.restaurant_id === tenant.restaurantId ? "bg-clay-50 text-clay-800" : "text-ink-600",
                    )}
                  >
                    <span className="truncate">{membership.restaurant_name}</span>
                    <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-ink-400">{membership.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Dashboard">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                        active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-ink-200 p-2">
        <Link
          href={`/menu/${tenant.restaurantSlug}`}
          target="_blank"
          className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-ink-600 hover:bg-ink-50"
        >
          <span className="truncate">View public menu</span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
        </Link>
        {isAdmin ? (
          <Link
            href="/platform"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-ink-600 hover:bg-ink-50"
          >
            <Shield className="size-3.5" aria-hidden /> Platform admin
          </Link>
        ) : null}
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-ink-500 hover:bg-ink-50 hover:text-ink-800"
          >
            <LogOut className="size-3.5" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-ink-50 lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-ink-200 lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink-900/40"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <div className="absolute inset-y-0 left-0 w-[268px] shadow-xl">{sidebar}</div>
        </div>
      ) : null}

      <div className="flex min-h-dvh flex-col lg:col-start-2">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-200 bg-ink-50/90 px-4 backdrop-blur-sm lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid size-9 place-items-center rounded-lg border border-ink-200 bg-white text-ink-600"
            aria-label="Open navigation"
          >
            <MenuIcon className="size-4" aria-hidden />
          </button>
          <span className="truncate text-[13px] font-semibold text-ink-900">{tenant.restaurantName}</span>
          {tenant.isDemo ? (
            <span className="ml-auto rounded-full bg-clay-50 px-2 py-0.5 text-[10.5px] font-medium text-clay-700 ring-1 ring-inset ring-clay-200">
              Demo
            </span>
          ) : null}
        </header>
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
