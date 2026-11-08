import { asAuthed, type AppUser } from "@/lib/auth/server";

/**
 * Platform-level service.
 *
 * Every function re-checks `mp_is_platform_admin()` inside the database, so a
 * normal restaurant owner calling these routes is denied even if they craft the
 * request by hand. Tenant-owned operational detail (orders, guests, menu) is never
 * returned here — only account metadata and aggregate health.
 */
export interface PlatformOverview {
  restaurants: number;
  active_restaurants: number;
  suspended_restaurants: number;
  users: number;
  orders: number;
  orders_30d: number;
  gmv_30d: string | number;
}

export interface PlatformRestaurant {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_demo: boolean;
  city: string | null;
  currency: string;
  created_at: string;
  owner_email: string | null;
  members: number;
  items: number;
  tables: number;
  orders_30d: number;
  gmv_30d: string;
}

export async function requirePlatformAdmin(user: AppUser): Promise<boolean> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ ok: boolean }>("select public.mp_is_platform_admin() as ok");
    return Boolean(res.rows[0]?.ok);
  });
}

export async function getPlatformOverview(user: AppUser): Promise<PlatformOverview> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ overview: PlatformOverview }>("select public.platform_overview() as overview");
    const row = res.rows[0]?.overview;
    if (!row) throw new Error("Platform overview unavailable");
    return row;
  });
}

export async function getPlatformRestaurants(user: AppUser): Promise<PlatformRestaurant[]> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ list: PlatformRestaurant[] }>(
      "select public.platform_restaurants() as list",
    );
    return res.rows[0]?.list ?? [];
  });
}

export async function getPlatformUsers(user: AppUser) {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{
      list: {
        id: string;
        email: string;
        full_name: string | null;
        created_at: string;
        last_sign_in_at: string | null;
        is_admin: boolean;
        restaurants: string | null;
      }[];
    }>("select public.platform_user_directory() as list");
    return res.rows[0]?.list ?? [];
  });
}

export async function setRestaurantStatus(
  user: AppUser,
  restaurantId: string,
  status: "active" | "suspended" | "pending",
): Promise<{ ok: boolean; error?: string }> {
  return asAuthed(user, async (tx) => {
    const admin = await tx.query<{ ok: boolean }>("select public.mp_is_platform_admin() as ok");
    if (!admin.rows[0]?.ok) return { ok: false, error: "Platform administrator access required." };
    const res = await tx.query(
      "update restaurants set status = $2 where id = $1 and is_demo = false",
      [restaurantId, status],
    );
    if (res.rowCount === 0) {
      return { ok: false, error: "That restaurant cannot be changed (demo tenants are protected)." };
    }
    await tx.query(
      `insert into audit_logs (restaurant_id, actor_user_id, action, entity, entity_id, metadata)
       values ($1, $2, 'platform.status_changed', 'restaurant', $1, $3)`,
      [restaurantId, user.id, JSON.stringify({ status })],
    );
    return { ok: true };
  });
}
