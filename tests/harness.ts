/**
 * Test harness.
 *
 * Every test runs against a real PostgreSQL engine with the real migrations and
 * the real RLS policies. Nothing is mocked: when a test asserts that restaurant A
 * cannot read restaurant B's orders, PostgreSQL itself is the thing being tested.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createPgliteDatabase } from "../src/lib/db/pglite";
import { migrate } from "../src/lib/db/migrate";
import type { Database, Queryable } from "../src/lib/db/types";
import { ANON, asUser, type SessionContext } from "../src/lib/db/types";

let dbInstance: Database | null = null;
let dataDir: string | null = null;

export async function setup(): Promise<Database> {
  if (dbInstance) return dbInstance;
  dataDir = await mkdtemp(path.join(tmpdir(), "menupilot-test-"));
  dbInstance = await createPgliteDatabase(dataDir);
  await migrate(dbInstance);

  // Point the application's shared handle at this database. Without this, service
  // code (signIn, getSessionUser, storage) would silently talk to `.data/pglite`
  // while the tests assert against the temp database — an integration test that
  // passes for the wrong reason is worse than no test.
  (globalThis as unknown as { __menupilotDb?: Promise<Database> }).__menupilotDb =
    Promise.resolve(dbInstance);
  return dbInstance;
}

export async function teardown(): Promise<void> {
  if (dbInstance) await dbInstance.close();
  (globalThis as unknown as { __menupilotDb?: Promise<Database> | null }).__menupilotDb = null;
  dbInstance = null;
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = null;
}

export async function db(): Promise<Database> {
  if (!dbInstance) return setup();
  return dbInstance;
}

/** Runs a callback with a session identity, mirroring production request handling. */
export async function as<T>(session: SessionContext, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const database = await db();
  let statementError: unknown = null;
  try {
    return await database.transaction(async (tx) => {
      const claims = { sub: session.userId ?? undefined, role: session.role };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${session.role}`);
      try {
        return await fn(tx);
      } catch (error) {
        statementError = error;
        throw error;
      } finally {
        await tx.query("reset role", []).catch(() => undefined);
      }
    });
  } catch (error) {
    throw statementError ?? error;
  }
}

export { ANON, asUser };

/* ------------------------------- fixtures -------------------------------- */

export interface Fixture {
  restaurantId: string;
  ownerId: string;
  managerId: string;
  kitchenId: string;
  categoryId: string;
  itemId: string;
  unavailableItemId: string;
  tableId: string;
  qrToken: string;
  otherRestaurantId: string;
  otherOwnerId: string;
  otherItemId: string;
  otherTableId: string;
  otherQrToken: string;
}

export async function createUser(email: string, password = "TestPass123"): Promise<string> {
  const database = await db();
  const { hashPassword } = await import("../src/lib/auth/password");
  const hash = await hashPassword(password);
  // Same shape the application writes: identity in auth.users (GoTrue-compatible),
  // credential material in public.user_credentials. This is what makes the suite
  // run unchanged against a Supabase database.
  const res = await database.query<{ id: string }>(
    "insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id",
    [email],
  );
  const userId = res.rows[0]!.id;
  await database.query(
    "insert into public.user_credentials (user_id, password_hash, full_name) values ($1,$2,$3)",
    [userId, hash, email.split("@")[0]],
  );
  return userId;
}

async function buildTenant(
  slug: string,
  name: string,
  ownerId: string,
  options: { tax?: number; service?: number; autoAccept?: boolean; acceptOrders?: boolean } = {},
): Promise<{ restaurantId: string; categoryId: string; itemId: string; unavailableItemId: string; tableId: string; qrToken: string }> {
  const database = await db();
  const rest = await database.query<{ id: string }>(
    `insert into restaurants (name, slug, status, currency, time_zone, created_by)
     values ($1,$2,'active','BDT','Asia/Dhaka',$3) returning id`,
    [name, slug, ownerId],
  );
  const restaurantId = rest.rows[0]!.id;

  await database.query(
    `insert into restaurant_settings (restaurant_id, tax_rate, tax_label, service_charge_rate,
       service_charge_label, accept_orders, auto_accept_orders, order_prefix)
     values ($1,$2,'VAT',$3,'Service charge',$4,$5,'TST')`,
    [restaurantId, options.tax ?? 5, options.service ?? 5, options.acceptOrders ?? true, options.autoAccept ?? false],
  );

  await database.query(
    "insert into restaurant_members (restaurant_id, user_id, role) values ($1,$2,'owner')",
    [restaurantId, ownerId],
  );

  const category = await database.query<{ id: string }>(
    "insert into categories (restaurant_id, name, sort_order) values ($1,'Mains',0) returning id",
    [restaurantId],
  );
  const categoryId = category.rows[0]!.id;

  const item = await database.query<{ id: string }>(
    "insert into menu_items (restaurant_id, category_id, name, slug, price, prep_minutes) values ($1,$2,'Test Biryani','test-biryani',500,20) returning id",
    [restaurantId, categoryId],
  );
  const unavailable = await database.query<{ id: string }>(
    "insert into menu_items (restaurant_id, category_id, name, slug, price, is_available) values ($1,$2,'Sold Out Dish','sold-out-dish',300,false) returning id",
    [restaurantId, categoryId],
  );

  const table = await database.query<{ id: string }>(
    "insert into dining_tables (restaurant_id, label, seats) values ($1,'Table 01',4) returning id",
    [restaurantId],
  );
  const tableId = table.rows[0]!.id;

  const qrToken = randomBytes(24).toString("hex");
  await database.query(
    "insert into qr_tokens (restaurant_id, table_id, token, token_sha256) values ($1,$2,$3,public.mp_sha256($3))",
    [restaurantId, tableId, qrToken],
  );

  return { restaurantId, categoryId, itemId: item.rows[0]!.id, unavailableItemId: unavailable.rows[0]!.id, tableId, qrToken };
}

export async function createSecondTenant(fixture: Partial<Fixture> = {}): Promise<Fixture> {
  const ownerId = await createUser(`owner-b-${Date.now()}@example.test`);
  const tenant = await buildTenant(`tenant-b-${Date.now()}`, "Tenant B", ownerId);
  const database = await db();
  await database.query(
    "update menu_items set name = 'B Kitchen Special', slug = 'b-kitchen-special' where id = $1",
    [tenant.itemId],
  );
  return {
    restaurantId: tenant.restaurantId,
    ownerId,
    managerId: "",
    kitchenId: "",
    categoryId: tenant.categoryId,
    itemId: tenant.itemId,
    unavailableItemId: tenant.unavailableItemId,
    tableId: tenant.tableId,
    qrToken: tenant.qrToken,
    otherRestaurantId: fixture.otherRestaurantId ?? "",
    otherOwnerId: fixture.otherOwnerId ?? "",
    otherItemId: fixture.otherItemId ?? "",
    otherTableId: fixture.otherTableId ?? "",
    otherQrToken: fixture.otherQrToken ?? "",
  };
}

let fixtureCache: Fixture | null = null;

export async function getFixture(): Promise<Fixture> {
  if (fixtureCache) return fixtureCache;
  const database = await db();
  const stamp = Date.now();
  const ownerId = await createUser(`owner-a-${stamp}@example.test`);
  const managerId = await createUser(`manager-a-${stamp}@example.test`);
  const kitchenId = await createUser(`kitchen-a-${stamp}@example.test`);
  const ownerBId = await createUser(`owner-b-${stamp}@example.test`);

  const a = await buildTenant(`tenant-a-${stamp}`, "Tenant A", ownerId);
  const b = await buildTenant(`tenant-b-${stamp}`, "Tenant B", ownerBId);

  await database.query("insert into restaurant_members (restaurant_id, user_id, role) values ($1,$2,'manager')", [a.restaurantId, managerId]);
  await database.query("insert into restaurant_members (restaurant_id, user_id, role) values ($1,$2,'kitchen')", [a.restaurantId, kitchenId]);

  fixtureCache = {
    restaurantId: a.restaurantId,
    ownerId,
    managerId,
    kitchenId,
    categoryId: a.categoryId,
    itemId: a.itemId,
    unavailableItemId: a.unavailableItemId,
    tableId: a.tableId,
    qrToken: a.qrToken,
    otherRestaurantId: b.restaurantId,
    otherOwnerId: ownerBId,
    otherItemId: b.itemId,
    otherTableId: b.tableId,
    otherQrToken: b.qrToken,
  };
  return fixtureCache;
}

/* ------------------------------ order helpers ---------------------------- */

export async function createOrderAsGuest(
  qrToken: string,
  items: { menu_item_id: string; quantity: number; note?: string }[],
  extra: { name?: string; phone?: string; note?: string; idempotencyKey?: string } = {},
): Promise<{ order_id?: string; order_number?: string; tracking_token?: string; total?: number; status?: string; error?: string }> {
  const result = await as(ANON, (tx) =>
    tx.query<{ result: Record<string, unknown> }>(
      "select public.create_order($1,$2::jsonb,$3,$4,$5,$6) as result",
      [qrToken, JSON.stringify(items), extra.name ?? null, extra.phone ?? null, extra.note ?? null, extra.idempotencyKey ?? null],
    ),
  );
  return (result.rows[0]?.result ?? {}) as never;
}

export async function transition(userId: string, orderId: string, next: string, reason?: string) {
  return as(asUser(userId), async (tx) => {
    const res = await tx.query<{ result: { status: string } }>(
      "select public.transition_order($1,$2,$3) as result",
      [orderId, next, reason ?? null],
    );
    return res.rows[0]?.result;
  });
}
