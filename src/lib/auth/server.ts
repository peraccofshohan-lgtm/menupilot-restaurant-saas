import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withSession } from "@/lib/db";
import { asUser, type Queryable } from "@/lib/db/types";
import { getSessionUser, SESSION_COOKIE, type AppUser } from "./session";

export type { AppUser };

export const RESTAURANT_COOKIE = "mp_restaurant";

export type TenantRole = "owner" | "manager" | "kitchen" | "waiter";

export interface Membership {
  restaurant_id: string;
  role: TenantRole;
  restaurant_name: string;
  restaurant_slug: string;
  restaurant_status: "pending" | "active" | "suspended";
  is_demo: boolean;
  currency: string;
  time_zone: string;
  logo_path: string | null;
}

export interface TenantContext {
  user: AppUser;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  currency: string;
  timeZone: string;
  logoPath: string | null;
  isDemo: boolean;
  role: TenantRole;
  memberships: Membership[];
}

/** Runs a query with the signed-in user's RLS identity. */
export async function asAuthed<T>(
  user: AppUser,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  return withSession(asUser(user.id), fn);
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE)?.value);
}

export async function requireUser(nextPath = "/dashboard"): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

export async function getMemberships(user: AppUser): Promise<Membership[]> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<Membership>(
      `select m.restaurant_id, m.role, r.name as restaurant_name, r.slug as restaurant_slug,
              r.status as restaurant_status, r.is_demo, r.currency, r.time_zone, r.logo_path
         from restaurant_members m
         join restaurants r on r.id = m.restaurant_id
        where m.user_id = public.mp_uid() and m.is_active
        order by r.is_demo asc, r.name asc`,
    );
    return res.rows;
  });
}

export async function isPlatformAdmin(user: AppUser): Promise<boolean> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ ok: boolean }>(
      "select public.mp_is_platform_admin() as ok",
    );
    return Boolean(res.rows[0]?.ok);
  });
}

/**
 * Resolves the tenant for the current request.
 *
 * The restaurant id is NEVER taken from the browser. It comes from the signed-in
 * user's membership rows; the cookie only selects *which* of their own restaurants
 * they are looking at, and it is validated against membership every time.
 */
export async function getTenantContext(options?: {
  requireOnboarded?: boolean;
}): Promise<TenantContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const memberships = await getMemberships(user);
  if (memberships.length === 0) return null;

  const store = await cookies();
  const preferred = store.get(RESTAURANT_COOKIE)?.value;
  const active =
    memberships.find((m) => m.restaurant_id === preferred) ??
    memberships.find((m) => m.restaurant_status === "active") ??
    memberships[0];
  if (!active) return null;

  if (options?.requireOnboarded && active.restaurant_status === "pending") return null;

  return {
    user,
    restaurantId: active.restaurant_id,
    restaurantName: active.restaurant_name,
    restaurantSlug: active.restaurant_slug,
    currency: active.currency,
    timeZone: active.time_zone,
    logoPath: active.logo_path,
    isDemo: active.is_demo,
    role: active.role,
    memberships,
  };
}

/** Dashboard pages: guarantees an authenticated, onboarded tenant user. */
export async function requireTenant(roles?: TenantRole[]): Promise<TenantContext> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  const ctx = await getTenantContext();
  if (!ctx) redirect("/onboarding");

  if (roles && !roles.includes(ctx.role)) {
    redirect(`/dashboard?denied=${roles.join(",")}`);
  }
  return ctx;
}

export function canManageMenu(role: TenantRole): boolean {
  return role === "owner" || role === "manager";
}

export function canManageStaff(role: TenantRole): boolean {
  return role === "owner";
}

export function canApproveOrders(role: TenantRole): boolean {
  return role === "owner" || role === "manager";
}

export function canUseKitchen(role: TenantRole): boolean {
  return role === "owner" || role === "manager" || role === "kitchen" || role === "waiter";
}

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Owner",
  manager: "Manager",
  kitchen: "Kitchen",
  waiter: "Waiter",
};
