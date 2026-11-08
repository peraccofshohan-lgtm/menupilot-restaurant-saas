/**
 * Demo reset.
 *
 * Presentation work creates a lot of test orders. This clears them so the next
 * demo starts clean — and it is deliberately narrow about what "them" means.
 *
 * The delete itself lives in `public.reset_demo_orders()` (migration 013), not
 * here. That is deliberate: `orders` has no DELETE policy because every order
 * write is supposed to pass through the state machine, and weakening a policy to
 * make a convenience feature work is how holes get opened. The function is
 * SECURITY DEFINER with all four guards inside it — signed in, exactly `owner` of
 * this restaurant, restaurant flagged `is_demo`, phrase `RESET` — plus a
 * before/after count check that raises if the menu or the QR set moved.
 *
 * This module maps those database errors to messages and shapes the preview.
 */
import { withSession } from "@/lib/db";
import { asUser, type Queryable } from "@/lib/db/types";

export interface DemoResetPreview {
  restaurantId: string;
  restaurantName: string;
  isDemo: boolean;
  orders: number;
  orderItems: number;
  statusHistory: number;
  customers: number;
  openOrders: number;
  protected: {
    categories: number;
    menuItems: number;
    diningTables: number;
    qrTokens: number;
  };
}

export type DemoResetErrorCode =
  | "not_demo"
  | "forbidden"
  | "confirmation_mismatch"
  | "unavailable";

export interface DemoResetResult {
  deleted: { orders: number; orderItems: number; statusHistory: number; customers: number };
  kept: DemoResetPreview["protected"];
}

interface RawCounts {
  orders: number;
  order_items: number;
  status_history: number;
  customers: number;
  open_orders: number;
  categories: number;
  menu_items: number;
  dining_tables: number;
  qr_tokens: number;
}

async function loadCounts(tx: Queryable, restaurantId: string): Promise<RawCounts> {
  const res = await tx.query<RawCounts>(
    `select
       (select count(*) from public.orders where restaurant_id = $1)::int as orders,
       (select count(*) from public.order_items where restaurant_id = $1)::int as order_items,
       (select count(*) from public.order_status_history h
          join public.orders o on o.id = h.order_id
         where o.restaurant_id = $1)::int as status_history,
       (select count(*) from public.customers where restaurant_id = $1)::int as customers,
       (select count(*) from public.orders
         where restaurant_id = $1
           and status in ('pending','accepted','preparing','ready'))::int as open_orders,
       (select count(*) from public.categories where restaurant_id = $1)::int as categories,
       (select count(*) from public.menu_items where restaurant_id = $1)::int as menu_items,
       (select count(*) from public.dining_tables where restaurant_id = $1)::int as dining_tables,
       (select count(*) from public.qr_tokens where restaurant_id = $1)::int as qr_tokens`,
    [restaurantId],
  );
  return res.rows[0]!;
}

/** Maps the SQL guard exceptions to a code the UI can explain. */
function mapError(error: unknown): DemoResetErrorCode {
  const message = String((error as { message?: string })?.message ?? error ?? "");
  if (message.includes("MP:NOT_DEMO")) return "not_demo";
  if (message.includes("MP:FORBIDDEN")) return "forbidden";
  if (message.includes("MP:CONFIRM")) return "confirmation_mismatch";
  return "unavailable";
}

export async function previewDemoReset(
  userId: string,
  restaurantId: string,
): Promise<{ ok: true; preview: DemoResetPreview } | { ok: false; error: DemoResetErrorCode }> {
  try {
    return await withSession(asUser(userId), async (tx) => {
      const tenant = (
        await tx.query<{ name: string; is_demo: boolean }>(
          "select name, is_demo from public.restaurants where id = $1",
          [restaurantId],
        )
      ).rows[0];
      if (!tenant) return { ok: false as const, error: "unavailable" as const };

      const c = await loadCounts(tx, restaurantId);
      return {
        ok: true as const,
        preview: {
          restaurantId,
          restaurantName: tenant.name,
          isDemo: tenant.is_demo,
          orders: c.orders,
          orderItems: c.order_items,
          statusHistory: c.status_history,
          customers: c.customers,
          openOrders: c.open_orders,
          protected: {
            categories: c.categories,
            menuItems: c.menu_items,
            diningTables: c.dining_tables,
            qrTokens: c.qr_tokens,
          },
        },
      };
    });
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * Deletes the demo tenant's orders via `reset_demo_orders()`.
 *
 * `expectedOrders` must equal the live order count; if a guest ordered between
 * the preview and the confirmation the function refuses rather than silently
 * widening what gets deleted.
 */
export async function resetDemoOrders(
  userId: string,
  restaurantId: string,
  expectedOrders: number,
  confirmPhrase: string,
): Promise<{ ok: true; result: DemoResetResult } | { ok: false; error: DemoResetErrorCode }> {
  try {
    return await withSession(asUser(userId), async (tx) => {
      const res = await tx.query<{ out: { before: Record<string, number>; after: Record<string, number> } }>(
        "select public.reset_demo_orders($1, $2, $3) as out",
        [restaurantId, expectedOrders, confirmPhrase],
      );
      const out = res.rows[0]!.out;
      return {
        ok: true as const,
        result: {
          deleted: {
            orders: out.before.orders ?? 0,
            orderItems: out.before.orderItems ?? 0,
            statusHistory: out.before.statusHistory ?? 0,
            customers: out.before.customers ?? 0,
          },
          kept: {
            categories: out.after.categories ?? 0,
            menuItems: out.after.menuItems ?? 0,
            diningTables: out.after.diningTables ?? 0,
            qrTokens: out.after.qrTokens ?? 0,
          },
        },
      };
    });
  } catch (error) {
    return { ok: false, error: mapError(error) };
  }
}
