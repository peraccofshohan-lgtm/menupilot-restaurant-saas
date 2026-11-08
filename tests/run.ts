/**
 * MenuPilot test suite.
 *
 * Run with `npm test`. Each suite exercises the real database, the real RLS
 * policies and the real business functions. A failing assertion here means the
 * product would misbehave for a real restaurant.
 */
import { ANON, as, asUser, createOrderAsGuest, createSecondTenant, db, getFixture, setup, teardown, transition } from "./harness";
import { hashPassword, verifyPassword, checkPasswordPolicy } from "../src/lib/auth/password";
import { makeSlug } from "../src/lib/validation";
import { friendlyTransitionError } from "../src/lib/services/orders";
import { mapServiceError } from "../src/lib/services/errors";
import { previewDemoReset, resetDemoOrders } from "../src/lib/services/demo-reset";

type TestFn = () => Promise<void> | void;
interface Test {
  name: string;
  fn: TestFn;
}
const suiteStack: { name: string; tests: Test[] }[] = [];
let current: { name: string; tests: Test[] } = { name: "root", tests: [] };
const results: { suite: string; name: string; ok: boolean; error?: string; ms: number }[] = [];

function describe(name: string, fn: () => void) {
  const previous = current;
  current = { name: `${previous.name === "root" ? "" : `${previous.name} › `}${name}`, tests: [] };
  const holder = current;
  suiteStack.push(holder);
  fn();
  current = previous;
  current.tests.push(...holder.tests);
}

function it(name: string, fn: TestFn) {
  current.tests.push({ name, fn });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(`${message ?? "Values differ"} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual: number, expected: number, tolerance = 0.01, message?: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message ?? "Numbers differ"} — expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

async function assertRejects(fn: () => Promise<unknown>, matcher: string, message?: string) {
  try {
    await fn();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert(text.includes(matcher), `${message ?? "Wrong error"} — expected message containing "${matcher}", got "${text}"`);
    return text;
  }
  throw new Error(`${message ?? "Expected a rejection"} — the call succeeded`);
}

/* ==========================================================================
   Authentication
   ========================================================================== */

describe("authentication", () => {
  it("hashes passwords with a salted KDF and verifies them", async () => {
    const hash = await hashPassword("CorrectHorse9");
    assert(hash.startsWith("scrypt$"), "hash should use the scrypt format");
    assert(!hash.includes("CorrectHorse9"), "hash must not contain the password");
    assert(await verifyPassword("CorrectHorse9", hash), "correct password should verify");
    assert(!(await verifyPassword("wrong-password", hash)), "wrong password must fail");
  });

  it("produces a different hash for the same password (unique salts)", async () => {
    const a = await hashPassword("SamePassword1");
    const b = await hashPassword("SamePassword1");
    assert(a !== b, "two hashes of the same password must differ");
  });

  it("enforces the password policy", () => {
    assertEquals(checkPasswordPolicy("short").ok, false, "short passwords rejected");
    assertEquals(checkPasswordPolicy("alllettersonly").ok, false, "letters-only rejected");
    assertEquals(checkPasswordPolicy("12345678").ok, false, "digits-only rejected");
    assertEquals(checkPasswordPolicy("GoodPass123").ok, true, "valid password accepted");
  });

  it("rejects a session token that is not in the database", async () => {
    const database = await db();
    const res = await database.query(
      "select 1 from public.app_sessions s where s.token_hash = $1 and s.expires_at > now()",
      ["not-a-real-hash"],
    );
    assertEquals(res.rows.length, 0, "unknown token resolves to no session");
  });

  it("expires sessions in the past", async () => {
    const database = await db();
    const fixture = await getFixture();
    await database.query(
      "insert into public.app_sessions (user_id, token_hash, expires_at) values ($1,'expired-hash', now() - interval '1 hour')",
      [fixture.ownerId],
    );
    const res = await database.query(
      "select 1 from public.app_sessions where token_hash = 'expired-hash' and expires_at > now()",
    );
    assertEquals(res.rows.length, 0, "expired session is not usable");
  });
});

/* ==========================================================================
   Multi-tenancy / RLS
   ========================================================================== */

describe("multi-tenancy (RLS)", () => {
  it("lets the owner read only their own orders", async () => {
    const f = await getFixture();
    await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await createOrderAsGuest(f.otherQrToken, [{ menu_item_id: f.otherItemId, quantity: 1 }]);

    const mine = await as(asUser(f.ownerId), (tx) => tx.query("select restaurant_id from orders"));
    assert(mine.rows.length > 0, "owner should see their own orders");
    assert(mine.rows.every((row) => (row as { restaurant_id: string }).restaurant_id === f.restaurantId), "owner must only see their own tenant's orders");

    const theirs = await as(asUser(f.otherOwnerId), (tx) => tx.query("select restaurant_id from orders"));
    assert(theirs.rows.every((row) => (row as { restaurant_id: string }).restaurant_id === f.otherRestaurantId), "second tenant only sees their own");
  });

  it("hides another tenant's menu writes behind RLS", async () => {
    const f = await getFixture();
    const updated = await as(asUser(f.ownerId), (tx) =>
      tx.query("update menu_items set price = 1 where id = $1", [f.otherItemId]),
    );
    assertEquals(updated.rowCount, 0, "tenant A cannot update tenant B's dish");

    const still = await db().then((database) => database.query<{ price: string }>("select price from menu_items where id = $1", [f.otherItemId]));
    assert(Number(still.rows[0]!.price) !== 1, "tenant B's price must be untouched");
  });

  it("blocks cross-tenant order reads", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 2 }]);
    assert(order.order_id, "order created");

    const leaked = await as(asUser(f.otherOwnerId), (tx) =>
      tx.query("select id from orders where id = $1", [order.order_id]),
    );
    assertEquals(leaked.rows.length, 0, "tenant B cannot read tenant A's order by id");
  });

  it("blocks cross-tenant order status changes", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await assertRejects(
      () => transition(f.otherOwnerId, order.order_id!, "accepted"),
      "MP:FORBIDDEN",
      "tenant B must not transition tenant A's order",
    );
  });

  it("denies anonymous access to orders, tables and customers", async () => {
    for (const table of ["orders", "order_items", "dining_tables", "qr_tokens", "customers", "restaurant_members", "audit_logs"]) {
      // Either the grant is missing or RLS returns nothing — both are a denial.
      const rows = await as(ANON, (tx) => tx.query(`select * from ${table} limit 1`)).catch(() => ({ rows: [] as unknown[] }));
      assertEquals(rows.rows.length, 0, `anon must not read ${table}`);
    }
  });

  it("lets anonymous guests read published menus only", async () => {
    const f = await getFixture();
    const items = await as(ANON, (tx) => tx.query<{ restaurant_id: string }>("select restaurant_id from menu_items"));
    assert(items.rows.length > 0, "anon can read published dishes");
    assert(items.rows.some((row) => row.restaurant_id === f.restaurantId), "includes the active tenant");

    const categories = await as(ANON, (tx) => tx.query("select id from categories"));
    assert(categories.rows.length > 0, "anon can read categories");
  });

  it("hides menu data once a restaurant is suspended", async () => {
    const f = await createFixtureTenant();
    const before = await as(ANON, (tx) => tx.query("select id from menu_items where restaurant_id = $1", [f.restaurantId]));
    assert(before.rows.length > 0, "visible while active");

    const database = await db();
    await database.query("update restaurants set status = 'suspended' where id = $1", [f.restaurantId]);
    const after = await as(ANON, (tx) => tx.query("select id from menu_items where restaurant_id = $1", [f.restaurantId]));
    assertEquals(after.rows.length, 0, "suspended tenants disappear from the public surface");

    const menu = await database.query<{ menu: unknown }>("select public.menu_by_slug($1) as menu", [`tenant-${f.restaurantId.slice(0, 8)}`]);
    void menu;
  });

  it("keeps tenant owners out of another tenant's member list", async () => {
    const f = await getFixture();
    const res = await as(asUser(f.ownerId), (tx) =>
      tx.query("select restaurant_id from restaurant_members where restaurant_id = $1", [f.otherRestaurantId]),
    );
    assertEquals(res.rows.length, 0, "owner cannot enumerate another tenant's staff");
  });

  it("does not let a kitchen user approve orders", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await assertRejects(
      () => transition(f.kitchenId, order.order_id!, "accepted"),
      "MP:FORBIDDEN_TRANSITION",
      "kitchen role must not accept orders",
    );
  });

  it("keeps the manager able to approve but not to delete the restaurant", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const accepted = await transition(f.managerId, order.order_id!, "accepted");
    assertEquals(accepted?.status, "accepted", "manager may accept");

    const deleted = await as(asUser(f.managerId), (tx) => tx.query("delete from restaurants where id = $1", [f.restaurantId]));
    assertEquals(deleted.rowCount, 0, "managers have no delete policy on restaurants");
  });
});

async function createFixtureTenant() {
  const fixture = await createSecondTenant();
  const database = await db();
  await database.query("update restaurants set slug = $2 where id = $1", [fixture.restaurantId, `tenant-${fixture.restaurantId.slice(0, 8)}`]);
  return fixture;
}

/* ==========================================================================
   QR access
   ========================================================================== */

describe("QR access control", () => {
  it("resolves a valid token to the right restaurant and table", async () => {
    const f = await getFixture();
    const database = await db();
    const res = await database.query<{ menu: { table: { id: string }; restaurant: { id: string } } }>(
      "select public.menu_for_qr($1) as menu",
      [f.qrToken],
    );
    const menu = res.rows[0]?.menu;
    assert(menu, "valid token returns a menu");
    assertEquals(menu.restaurant.id, f.restaurantId, "correct restaurant");
    assertEquals(menu.table.id, f.tableId, "correct table");
  });

  it("returns nothing for an unknown token", async () => {
    const database = await db();
    for (const token of ["", "short", "0".repeat(48), "f".repeat(48)]) {
      const res = await database.query<{ menu: unknown }>("select public.menu_for_qr($1) as menu", [token]);
      assertEquals(res.rows[0]?.menu ?? null, null, `token "${token.slice(0, 8)}" must not resolve`);
    }
  });

  it("stops working when the token is revoked", async () => {
    const database = await db();
    const fixture = await createSecondTenant();
    const before = await database.query<{ menu: unknown }>("select public.menu_for_qr($1) as menu", [fixture.qrToken]);
    assert(before.rows[0]?.menu, "token works before revocation");

    await database.query("update qr_tokens set is_active = false, revoked_at = now() where token = $1", [fixture.qrToken]);
    const after = await database.query<{ menu: unknown }>("select public.menu_for_qr($1) as menu", [fixture.qrToken]);
    assertEquals(after.rows[0]?.menu ?? null, null, "revoked token stops resolving");
  });

  it("stops working when the table is deactivated", async () => {
    const database = await db();
    const fixture = await createSecondTenant();
    await database.query("update dining_tables set is_active = false where id = $1", [fixture.tableId]);
    const res = await database.query<{ menu: unknown }>("select public.menu_for_qr($1) as menu", [fixture.qrToken]);
    assertEquals(res.rows[0]?.menu ?? null, null, "inactive table breaks the QR");
  });

  it("cannot be bypassed by supplying a table id instead of a token", async () => {
    const f = await getFixture();
    const database = await db();
    const res = await database.query<{ menu: unknown }>("select public.menu_for_qr($1) as menu", [f.tableId]);
    assertEquals(res.rows[0]?.menu ?? null, null, "a raw uuid is not a token");
  });
});

/* ==========================================================================
   Customer ordering
   ========================================================================== */

describe("customer ordering", () => {
  it("creates a pending order with server-calculated totals", async () => {
    const f = await getFixture();
    const result = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 3 }], { name: "Guest One" });
    assert(result.order_id, "order id returned");
    assert(result.tracking_token && result.tracking_token.length >= 40, "tracking token issued");
    assertEquals(result.status, "pending", "new orders start pending");

    const database = await db();
    const order = await database.query<{ subtotal: string; total: string; tax_amount: string; service_charge: string; status: string; item_count: number }>(
      "select subtotal, total, tax_amount, service_charge, status, item_count from orders where id = $1",
      [result.order_id],
    );
    const row = order.rows[0]!;
    assertClose(Number(row.subtotal), 1500, 0.01, "3 × 500 subtotal");
    assertClose(Number(row.service_charge), 75, 0.01, "5% service charge");
    assertClose(Number(row.tax_amount), 75, 0.01, "5% VAT");
    assertClose(Number(row.total), 1650, 0.01, "total includes tax and service");
    assertEquals(row.status, "pending", "status stays pending");
    assertEquals(row.item_count, 3, "item count sums quantities");
  });

  it("ignores client-supplied prices and totals", async () => {
    const f = await getFixture();
    const database = await db();
    const result = await as(ANON, (tx) =>
      tx.query<{ result: { total: number } }>(
        "select public.create_order($1,$2::jsonb,$3,$4,$5,$6) as result",
        [
          f.qrToken,
          JSON.stringify([{ menu_item_id: f.itemId, quantity: 1, price: 0, unit_price: 0, line_total: 0 }]),
          null,
          null,
          null,
          null,
        ],
      ),
    );
    const total = Number(result.rows[0]!.result.total);
    assert(total > 0, "server ignores client prices");
    assertClose(total, 550, 0.01, "1 × 500 + 5% + 5%");

    const line = await database.query<{ unit_price: string }>(
      "select unit_price from order_items where order_id = (select id from orders where order_number = (select order_number from orders order by created_at desc limit 1))",
    );
    if (line.rows[0]) assertClose(Number(line.rows[0].unit_price), 500, 0.01, "unit price snapshotted from the menu");
  });

  it("rejects a dish from another restaurant", async () => {
    const f = await getFixture();
    await assertRejects(
      () => createOrderAsGuest(f.qrToken, [{ menu_item_id: f.otherItemId, quantity: 1 }]),
      "MP:ITEM_UNAVAILABLE",
      "cross-tenant item must be rejected",
    );
  });

  it("rejects an unavailable dish", async () => {
    const f = await getFixture();
    await assertRejects(
      () => createOrderAsGuest(f.qrToken, [{ menu_item_id: f.unavailableItemId, quantity: 1 }]),
      "MP:ITEM_UNAVAILABLE",
      "sold-out dish must be rejected",
    );
  });

  it("rejects an invalid QR token", async () => {
    const f = await getFixture();
    await assertRejects(
      () => createOrderAsGuest("0".repeat(48), [{ menu_item_id: f.itemId, quantity: 1 }]),
      "MP:INVALID_QR",
      "unknown token must not create orders",
    );
  });

  it("rejects an empty cart", async () => {
    const f = await getFixture();
    await assertRejects(() => createOrderAsGuest(f.qrToken, []), "MP:EMPTY_CART", "empty cart rejected");
  });

  it("clamps abusive quantities instead of trusting them", async () => {
    const f = await getFixture();
    const result = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 9999 }]);
    const database = await db();
    const item = await database.query<{ quantity: number }>("select quantity from order_items where order_id = $1", [result.order_id]);
    assertEquals(item.rows[0]!.quantity, 99, "quantity is clamped to 99");
  });

  it("is idempotent for the same key", async () => {
    const f = await getFixture();
    const key = `idem-${Date.now()}`;
    const first = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }], { idempotencyKey: key });
    const second = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }], { idempotencyKey: key });
    assertEquals(first.order_number, second.order_number, "same order returned");
    const database = await db();
    const count = await database.query<{ count: string }>(
      "select count(*)::text as count from orders where idempotency_key = $1",
      [key],
    );
    assertEquals(count.rows[0]!.count, "1", "only one order stored");
  });

  it("records a status-history row for the placement", async () => {
    const f = await getFixture();
    const result = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const database = await db();
    const history = await database.query<{ to_status: string }>(
      "select to_status from order_status_history where order_id = $1 order by created_at",
      [result.order_id],
    );
    assertEquals(history.rows[0]?.to_status, "pending", "placement is audited");
    assertEquals(history.rows.length, 1, "no phantom transition rows");
  });

  it("exposes tracking only to the holder of the token", async () => {
    const f = await getFixture();
    const result = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 2 }], { name: "Tracked Guest" });
    const database = await db();
    const good = await database.query<{ order: { order_number: string; items: unknown[] } }>(
      "select public.get_order_tracking($1) as order",
      [result.tracking_token],
    );
    assert(good.rows[0]?.order, "valid token resolves");
    assertEquals(good.rows[0]!.order.order_number, result.order_number, "same order");
    assert(good.rows[0]!.order.items.length > 0, "items included");

    const bad = await database.query<{ order: unknown }>("select public.get_order_tracking($1) as order", ["x".repeat(48)]);
    assertEquals(bad.rows[0]?.order ?? null, null, "unknown token resolves to nothing");
  });

  it("does not leak tenant internals through tracking", async () => {
    const f = await getFixture();
    const result = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const database = await db();
    const res = await database.query<{ order: Record<string, unknown> }>(
      "select public.get_order_tracking($1) as order",
      [result.tracking_token],
    );
    const order = res.rows[0]!.order;
    assert(!("restaurant_id" in order), "no restaurant id");
    assert(!("id" in order), "no internal order id");
    assert(!("table_id" in order), "no table id");
    assert(!("customer_phone" in order), "no guest phone echoed back");
  });

  it("stops accepting orders when the restaurant pauses ordering", async () => {
    const database = await db();
    const fixture = await createSecondTenant();
    await database.query("update restaurant_settings set accept_orders = false where restaurant_id = $1", [fixture.restaurantId]);
    await assertRejects(
      () => createOrderAsGuest(fixture.qrToken, [{ menu_item_id: fixture.itemId, quantity: 1 }]),
      "MP:ORDERING_DISABLED",
      "ordering disabled blocks new orders",
    );
  });
});

/* ==========================================================================
   Order lifecycle
   ========================================================================== */

describe("order lifecycle", () => {
  it("runs pending → accepted → preparing → ready → served", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }], { name: "Lifecycle" });
    const id = order.order_id!;

    assertEquals((await transition(f.ownerId, id, "accepted"))?.status, "accepted");
    assertEquals((await transition(f.kitchenId, id, "preparing"))?.status, "preparing", "kitchen can start prep");
    assertEquals((await transition(f.kitchenId, id, "ready"))?.status, "ready", "kitchen can mark ready");
    assertEquals((await transition(f.ownerId, id, "served"))?.status, "served");

    const database = await db();
    const row = await database.query<{ accepted_at: string | null; preparing_at: string | null; ready_at: string | null; served_at: string | null }>(
      "select accepted_at, preparing_at, ready_at, served_at from orders where id = $1",
      [id],
    );
    const stamps = row.rows[0]!;
    assert(stamps.accepted_at && stamps.preparing_at && stamps.ready_at && stamps.served_at, "every stage is timestamped");

    const history = await database.query<{ to_status: string }>(
      "select to_status from order_status_history where order_id = $1 order by created_at",
      [id],
    );
    assertEquals(history.rows.map((r) => r.to_status).join(","), "pending,accepted,preparing,ready,served", "audit trail is complete");
  });

  it("rejects a pending → ready shortcut", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await assertRejects(() => transition(f.ownerId, order.order_id!, "ready"), "MP:INVALID_TRANSITION", "cannot skip approval");
  });

  it("rejects a preparing transition from pending", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await assertRejects(
      () => transition(f.kitchenId, order.order_id!, "preparing"),
      "MP:INVALID_TRANSITION:pending->preparing",
      "a pending order cannot enter preparation, whatever the role",
    );
  });

  it("does not let a rejected order move forward", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await transition(f.ownerId, order.order_id!, "rejected", "Out of stock");
    await assertRejects(() => transition(f.ownerId, order.order_id!, "accepted"), "MP:INVALID_TRANSITION", "rejected is terminal");
    await assertRejects(() => transition(f.ownerId, order.order_id!, "preparing"), "MP:INVALID_TRANSITION", "rejected cannot cook");
  });

  it("does not let a served order be served twice", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const id = order.order_id!;
    await transition(f.ownerId, id, "accepted");
    await transition(f.kitchenId, id, "preparing");
    await transition(f.kitchenId, id, "ready");
    await transition(f.ownerId, id, "served");
    await assertRejects(() => transition(f.ownerId, id, "served"), "MP:INVALID_TRANSITION", "served is terminal");
  });

  it("records the reason and actor on rejection", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await transition(f.managerId, order.order_id!, "rejected", "Kitchen closing");
    const database = await db();
    const row = await database.query<{ rejection_reason: string; rejected_by: string; status: string }>(
      "select rejection_reason, rejected_by, status from orders where id = $1",
      [order.order_id],
    );
    assertEquals(row.rows[0]!.rejection_reason, "Kitchen closing");
    assertEquals(row.rows[0]!.rejected_by, f.managerId, "actor recorded");
    assertEquals(row.rows[0]!.status, "rejected");
  });

  it("lets a waiter serve but not prepare", async () => {
    const database = await db();
    const f = await getFixture();
    const waiterId = await (await import("./harness")).createUser(`waiter-${Date.now()}@example.test`);
    await database.query("insert into restaurant_members (restaurant_id, user_id, role) values ($1,$2,'waiter')", [f.restaurantId, waiterId]);

    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const id = order.order_id!;
    await transition(f.ownerId, id, "accepted");
    await assertRejects(() => transition(waiterId, id, "preparing"), "MP:FORBIDDEN_TRANSITION", "waiter cannot cook");
    await transition(f.kitchenId, id, "preparing");
    await transition(f.kitchenId, id, "ready");
    assertEquals((await transition(waiterId, id, "served"))?.status, "served", "waiter can serve");
  });

  it("keeps pending orders out of the kitchen feed", async () => {
    const database = await db();
    const f = await getFixture();
    const pending = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const accepted = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await transition(f.ownerId, accepted.order_id!, "accepted");

    const feed = await as(asUser(f.kitchenId), (tx) =>
      tx.query<{ feed: { id: string; status: string }[] }>("select public.kitchen_feed($1) as feed", [f.restaurantId]),
    );
    const ids = feed.rows[0]!.feed.map((ticket) => ticket.id);
    assert(ids.includes(accepted.order_id!), "accepted ticket is visible");
    assert(!ids.includes(pending.order_id!), "pending ticket is not visible to the kitchen");
    assert(feed.rows[0]!.feed.every((ticket) => ["accepted", "preparing", "ready"].includes(ticket.status)), "feed only holds kitchen states");
  });

  it("auto-accepts when the restaurant opts in", async () => {
    const database = await db();
    const fixture = await createSecondTenant();
    await database.query("update restaurant_settings set auto_accept_orders = true where restaurant_id = $1", [fixture.restaurantId]);
    const order = await createOrderAsGuest(fixture.qrToken, [{ menu_item_id: fixture.itemId, quantity: 1 }]);
    assertEquals(order.status, "accepted", "auto-accept skips the pending state");
  });
});

/* ==========================================================================
   Dashboard aggregates
   ========================================================================== */

describe("dashboard metrics", () => {
  it("computes today's counts and revenue from real rows", async () => {
    const f = await getFixture();
    const database = await db();

    const a = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await transition(f.ownerId, a.order_id!, "accepted");
    await transition(f.kitchenId, a.order_id!, "preparing");
    await transition(f.kitchenId, a.order_id!, "ready");

    const b = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 2 }]);
    await transition(f.ownerId, b.order_id!, "accepted");

    const c = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await transition(f.ownerId, c.order_id!, "rejected", "test");

    const res = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ overview: { today: { orders: number; pending: number; accepted: number; preparing: number; ready: number; rejected: number }; pending_orders: number } }>(
        "select public.restaurant_overview($1) as overview",
        [f.restaurantId],
      ),
    );
    const overview = res.rows[0]!.overview;
    assert(overview.today.orders >= 3, "all three orders counted");
    assert(overview.today.ready >= 1, "ready counted");
    assert(overview.today.accepted >= 1, "accepted counted");
    assert(overview.today.rejected >= 1, "rejected counted separately");

    const actual = await database.query<{ count: string }>(
      "select count(*)::text as count from orders where restaurant_id = $1 and status = 'ready'",
      [f.restaurantId],
    );
    assertEquals(overview.today.ready, Number(actual.rows[0]!.count), "ready count matches the table");
  });

  it("excludes rejected and cancelled orders from revenue", async () => {
    const f = await getFixture();
    const database = await db();
    const before = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ overview: { today: { revenue: number } } }>("select public.restaurant_overview($1) as overview", [f.restaurantId]),
    );
    const revenueBefore = Number(before.rows[0]!.overview.today.revenue);

    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 5 }]);
    await transition(f.ownerId, order.order_id!, "rejected", "no");

    const after = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ overview: { today: { revenue: number } } }>("select public.restaurant_overview($1) as overview", [f.restaurantId]),
    );
    assertEquals(Number(after.rows[0]!.overview.today.revenue), revenueBefore, "rejected order adds no revenue");
    void database;
  });

  it("refuses overview access to a non-member", async () => {
    const f = await getFixture();
    await assertRejects(
      () =>
        as(asUser(f.otherOwnerId), (tx) =>
          tx.query("select public.restaurant_overview($1) as overview", [f.restaurantId]),
        ),
      "MP:FORBIDDEN",
      "cross-tenant overview denied",
    );
  });

  it("respects the restaurant time zone for the business day", async () => {
    const f = await getFixture();
    const res = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ overview: { time_zone: string; business_date: string } }>(
        "select public.restaurant_overview($1) as overview",
        [f.restaurantId],
      ),
    );
    assertEquals(res.rows[0]!.overview.time_zone, "Asia/Dhaka");

    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
    assertEquals(res.rows[0]!.overview.business_date, expected, "business date follows the tenant zone");
  });

  it("counts revenue only for completed orders in analytics", async () => {
    const f = await getFixture();
    const database = await db();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 2 }]);
    await transition(f.ownerId, order.order_id!, "accepted");
    await transition(f.kitchenId, order.order_id!, "preparing");
    await transition(f.kitchenId, order.order_id!, "ready");

    const from = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
    const res = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ analytics: { totals: { revenue: number; completed_orders: number } } }>(
        "select public.restaurant_analytics($1, $2::date, $2::date) as analytics",
        [f.restaurantId, from],
      ),
    );
    const analytics = res.rows[0]!.analytics;
    assert(Number(analytics.totals.revenue) >= 1100, "ready order revenue counted (2 × 500 + tax + service)");
    assert(analytics.totals.completed_orders >= 1, "completed order counted");

    const sum = await database.query<{ total: string }>(
      "select coalesce(sum(total),0)::text as total from orders where restaurant_id = $1 and status in ('ready','served') and (created_at at time zone 'Asia/Dhaka')::date = $2::date",
      [f.restaurantId, from],
    );
    assertClose(Number(analytics.totals.revenue), Number(sum.rows[0]!.total), 0.02, "analytics revenue matches the sum of completed orders");
  });

  it("rejects an invalid analytics range", async () => {
    const f = await getFixture();
    await assertRejects(
      () =>
        as(asUser(f.ownerId), (tx) =>
          tx.query("select public.restaurant_analytics($1, $2::date, $3::date)", [f.restaurantId, "2026-01-10", "2026-01-01"]),
        ),
      "MP:INVALID_RANGE",
      "backwards ranges are refused",
    );
  });
});

/* ==========================================================================
   Menu management
   ========================================================================== */

describe("menu management", () => {
  it("creates, updates and archives a dish as the owner", async () => {
    const f = await getFixture();
    const created = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ id: string }>(
        `insert into menu_items (restaurant_id, category_id, name, slug, price)
         values ($1,$2,'Owner Dish','owner-dish',250) returning id`,
        [f.restaurantId, f.categoryId],
      ),
    );
    const id = created.rows[0]!.id;

    const updated = await as(asUser(f.ownerId), (tx) =>
      tx.query("update menu_items set price = 300 where id = $1", [id]),
    );
    assertEquals(updated.rowCount, 1, "owner can update");

    const archived = await as(asUser(f.ownerId), (tx) =>
      tx.query("update menu_items set is_archived = true where id = $1", [id]),
    );
    assertEquals(archived.rowCount, 1, "owner can archive");

    const publicView = await as(ANON, (tx) => tx.query("select id from menu_items where id = $1", [id]));
    assertEquals(publicView.rows.length, 0, "archived dishes disappear from the public menu");
  });

  it("blocks a kitchen user from editing the menu", async () => {
    const f = await getFixture();
    const res = await as(asUser(f.kitchenId), (tx) =>
      tx.query("update menu_items set price = 1 where id = $1", [f.itemId]),
    );
    assertEquals(res.rowCount, 0, "kitchen role has no write policy on the menu");
  });

  it("enforces unique slugs per restaurant but allows reuse across tenants", async () => {
    const database = await db();
    const f = await getFixture();
    await database.query(
      "insert into menu_items (restaurant_id, category_id, name, slug, price) values ($1,$2,'Shared Name','dup-slug',100)",
      [f.restaurantId, f.categoryId],
    );
    await assertRejects(
      () =>
        database.query(
          "insert into menu_items (restaurant_id, category_id, name, slug, price) values ($1,$2,'Shared Name 2','dup-slug',100)",
          [f.restaurantId, f.categoryId],
        ),
      "duplicate key",
      "slug is unique within a tenant",
    );

    const other = await createSecondTenant();
    await database.query(
      "insert into menu_items (restaurant_id, category_id, name, slug, price) values ($1,$2,'Shared Name','dup-slug',100)",
      [other.restaurantId, other.categoryId],
    );
  });

  it("rejects negative prices at the database level", async () => {
    const database = await db();
    const f = await getFixture();
    await assertRejects(
      () =>
        database.query(
          "insert into menu_items (restaurant_id, category_id, name, slug, price) values ($1,$2,'Bad Price','bad-price',-5)",
          [f.restaurantId, f.categoryId],
        ),
      "violates check constraint",
      "negative prices are impossible",
    );
  });

  it("rejects a category reference from another tenant at the storage layer", async () => {
    const database = await db();
    const f = await getFixture();
    const other = await createSecondTenant();

    // Composite FK (restaurant_id, category_id) makes this impossible even for
    // a superuser writing raw SQL — no RLS, no application code involved.
    await assertRejects(
      () =>
        database.query(
          "insert into menu_items (restaurant_id, category_id, name, slug, price) values ($1,$2,'Cross Dish','cross-dish',100)",
          [f.restaurantId, other.categoryId],
        ),
      "menu_items_tenant_category_fkey",
      "a dish cannot reference another restaurant's category",
    );
  });

  it("blocks cross-tenant menu writes through RLS", async () => {
    const f = await getFixture();
    const inserted = await as(asUser(f.otherOwnerId), (tx) =>
      tx.query(
        "insert into menu_items (restaurant_id, category_id, name, slug, price) values ($1,$2,'Cross Dish','cross-dish-rls',100)",
        [f.restaurantId, f.categoryId],
      ),
    )
      .then((result) => result.rowCount)
      .catch(() => 0);
    assertEquals(inserted, 0, "tenant B cannot insert a dish into tenant A");

    const database = await db();
    const row = await database.query("select id from menu_items where slug = 'cross-dish-rls'");
    assertEquals(row.rows.length, 0, "nothing was written");
  });

  it("keeps order money immutable after creation", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const database = await db();
    await assertRejects(
      () => database.query("update orders set total = 1 where id = $1", [order.order_id]),
      "MP:IMMUTABLE_ORDER_FIELD",
      "totals cannot be rewritten after the fact",
    );
  });

  it("keeps at least one owner in every restaurant", async () => {
    const database = await db();
    const fixture = await createSecondTenant();
    const ownerMember = await database.query<{ id: string }>(
      "select id from restaurant_members where restaurant_id = $1 and role = 'owner'",
      [fixture.restaurantId],
    );
    await assertRejects(
      () => database.query("update restaurant_members set role = 'waiter' where id = $1", [ownerMember.rows[0]!.id]),
      "MP:LAST_OWNER",
      "the final owner cannot be demoted",
    );
    await assertRejects(
      () => database.query("delete from restaurant_members where id = $1", [ownerMember.rows[0]!.id]),
      "MP:LAST_OWNER",
      "the final owner cannot be deleted",
    );
  });

  it("generates safe slugs", () => {
    assertEquals(makeSlug("Beef Bhuna!"), "beef-bhuna");
    assertEquals(makeSlug("  Chicken  &  Rice  "), "chicken-and-rice");
    assertEquals(makeSlug("MATI Kitchen"), "mati-kitchen");
  });
});

/* ==========================================================================
   Staff, settings and platform
   ========================================================================== */

describe("staff and settings", () => {
  it("only lets owners change member roles", async () => {
    const f = await getFixture();
    const database = await db();
    const target = await database.query<{ id: string }>(
      "select id from restaurant_members where restaurant_id = $1 and user_id = $2",
      [f.restaurantId, f.kitchenId],
    );
    const managerAttempt = await as(asUser(f.managerId), (tx) =>
      tx.query("update restaurant_members set role = 'manager' where id = $1", [target.rows[0]!.id]),
    );
    assertEquals(managerAttempt.rowCount, 0, "managers cannot elevate roles");

    const ownerAttempt = await as(asUser(f.ownerId), (tx) =>
      tx.query("update restaurant_members set role = 'waiter' where id = $1", [target.rows[0]!.id]),
    );
    assertEquals(ownerAttempt.rowCount, 1, "owner can change roles");

    await database.query("update restaurant_members set role = 'kitchen' where id = $1", [target.rows[0]!.id]);
  });

  it("lets only owners and managers write settings", async () => {
    const f = await getFixture();
    const kitchenAttempt = await as(asUser(f.kitchenId), (tx) =>
      tx.query("update restaurant_settings set tax_rate = 50 where restaurant_id = $1", [f.restaurantId]),
    );
    assertEquals(kitchenAttempt.rowCount, 0, "kitchen cannot change tax");

    const managerAttempt = await as(asUser(f.managerId), (tx) =>
      tx.query("update restaurant_settings set tax_rate = 7.5 where restaurant_id = $1", [f.restaurantId]),
    );
    assertEquals(managerAttempt.rowCount, 1, "manager can change tax");

    const database = await db();
    await database.query("update restaurant_settings set tax_rate = 5 where restaurant_id = $1", [f.restaurantId]);
  });

  it("denies platform aggregates to a normal owner", async () => {
    const f = await getFixture();
    await assertRejects(
      () => as(asUser(f.ownerId), (tx) => tx.query("select public.platform_overview()")),
      "MP:FORBIDDEN",
      "owners cannot read platform figures",
    );
  });

  it("grants platform aggregates to a platform admin", async () => {
    const database = await db();
    const adminId = await (await import("./harness")).createUser(`admin-${Date.now()}@example.test`);
    await database.query("insert into platform_admins (user_id) values ($1)", [adminId]);
    const res = await as(asUser(adminId), (tx) => tx.query<{ overview: { restaurants: number } }>("select public.platform_overview() as overview"));
    assert(res.rows[0]!.overview.restaurants >= 1, "admin sees tenant totals");
  });

  it("exposes the team directory to members without unlocking the auth schema", async () => {
    const f = await getFixture();
    const res = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ directory: { email: string; role: string; full_name: string | null }[] }>(
        "select public.staff_directory($1) as directory",
        [f.restaurantId],
      ),
    );
    const directory = res.rows[0]!.directory;
    assert(directory.length >= 3, "the whole team is listed");
    assert(directory[0]!.role === "owner", "the owner is listed first");
    assert(directory.some((m) => m.email.includes("@")), "emails resolve for the team list");

    const kitchenView = await as(asUser(f.kitchenId), (tx) =>
      tx.query<{ directory: unknown[] }>("select public.staff_directory($1) as directory", [f.restaurantId]),
    );
    assert(kitchenView.rows[0]!.directory.length >= 3, "kitchen staff can see who is on the team");
  });

  it("keeps the auth schema itself sealed to application roles", async () => {
    const f = await getFixture();
    // Reading auth.users directly must stay impossible; the directory functions exist
    // precisely so that page code never needs this grant.
    await assertRejects(
      () => as(asUser(f.ownerId), (tx) => tx.query("select email from auth.users limit 1")),
      "permission denied",
      "owners cannot read auth.users directly",
    );
  });

  it("scopes the staff directory to the caller's own tenant", async () => {
    const f = await getFixture();
    await assertRejects(
      () => as(asUser(f.ownerId), (tx) => tx.query("select public.staff_directory($1)", [f.otherRestaurantId])),
      "MP:FORBIDDEN",
      "a tenant owner cannot enumerate another tenant's team",
    );
  });

  it("keeps the account directory for platform admins only", async () => {
    const f = await getFixture();
    await assertRejects(
      () => as(asUser(f.ownerId), (tx) => tx.query("select public.platform_user_directory()")),
      "MP:FORBIDDEN",
      "owners cannot read the account directory",
    );
    await assertRejects(
      () => as(asUser(f.ownerId), (tx) => tx.query("select public.platform_restaurants()")),
      "MP:FORBIDDEN",
      "owners cannot read the platform restaurant list",
    );

    const database = await db();
    const adminId = await (await import("./harness")).createUser(`admin-dir-${Date.now()}@example.test`);
    await database.query("insert into platform_admins (user_id) values ($1)", [adminId]);
    const res = await as(asUser(adminId), (tx) =>
      tx.query<{ list: { slug: string; owner_email: string | null }[] }>("select public.platform_restaurants() as list"),
    );
    assert(res.rows[0]!.list.length >= 2, "admins see every tenant");
    assert(
      res.rows[0]!.list.every((r) => typeof r.owner_email === "string"),
      "each tenant resolves an owner email",
    );
  });

  it("refuses an invalid status transition value", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await assertRejects(() => transition(f.ownerId, order.order_id!, "flying"), "MP:INVALID_TRANSITION", "unknown statuses are refused");
  });
});

/* ==========================================================================
   Rate limiting
   ========================================================================== */

describe("error copy", () => {
  it("turns a coded transition error into a sentence a waiter can read", () => {
    const copy = friendlyTransitionError("MP:INVALID_TRANSITION:served->preparing");
    assert(!copy.includes("MP:"), "no internal code leaks into the UI");
    assert(!copy.includes("undefined"), "no undefined placeholders");
    assert(copy.includes("served") && copy.includes("preparing"), "the copy names both states");
  });

  it("keeps role, permission and missing-order errors calm and specific", () => {
    assert(friendlyTransitionError("MP:FORBIDDEN_TRANSITION:kitchen") === "Your role cannot perform that action.", "role copy");
    assert(friendlyTransitionError("MP:FORBIDDEN") === "You do not have access to this order.", "permission copy");
    assert(friendlyTransitionError("MP:ORDER_NOT_FOUND") === "This order no longer exists.", "missing order copy");
    assert(friendlyTransitionError("some unexpected driver failure") === "That change could not be applied.", "unknown errors stay generic");
  });

  it("maps storage and request failures without echoing database internals", () => {
    const forbidden = mapServiceError(new Error('MP:FORBIDDEN: row-level security policy violated for table "orders"'));
    assertEquals(forbidden.status, 403, "permissions become a 403");
    assert(!forbidden.message.toLowerCase().includes("row-level"), "policy text never reaches the client");

    const missing = mapServiceError(new Error("MP:ORDER_NOT_FOUND"));
    assertEquals(missing.status, 404, "unknown rows become a 404");

    const unknown = mapServiceError(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    assertEquals(unknown.status, 500, "infrastructure errors become a 500");
    assert(!unknown.message.includes("ECONNREFUSED"), "driver errors stay server-side");
  });
});

describe("abuse protection", () => {
  it("allows up to the limit then blocks", async () => {
    const database = await db();
    const key = `test-${Date.now()}`;
    for (let i = 0; i < 3; i += 1) {
      const res = await database.query<{ result: { allowed: boolean } }>(
        "select public.consume_rate_limit($1, 3, 60) as result",
        [key],
      );
      assertEquals(res.rows[0]!.result.allowed, true, `request ${i + 1} allowed`);
    }
    const blocked = await database.query<{ result: { allowed: boolean; retry_after: number } }>(
      "select public.consume_rate_limit($1, 3, 60) as result",
      [key],
    );
    assertEquals(blocked.rows[0]!.result.allowed, false, "fourth request blocked");
    assert(blocked.rows[0]!.result.retry_after > 0, "retry hint provided");
  });

  it("keeps user data out of rate-limit keys", async () => {
    const database = await db();
    const res = await database.query<{ key: string }>("select key from rate_limit_buckets limit 5");
    for (const row of res.rows) {
      assert(!row.key.includes("@"), "no email in limiter keys");
      assert(!/\d+\.\d+\.\d+\.\d+/.test(row.key), "no raw IP in limiter keys");
    }
  });
});

/* ==========================================================================
   Runner
   ========================================================================== */

async function main() {
  const started = Date.now();
  console.log("\n  MenuPilot test suite\n");
  await setup();

  const formatter = new Intl.NumberFormat("en-US");

  describe("demo reset", () => {
    /** Marks the fixture tenant as a demo so the reset path is reachable. */
    async function setDemo(restaurantId: string, isDemo: boolean) {
      const database = await db();
      await database.query("update public.restaurants set is_demo = $2 where id = $1", [restaurantId, isDemo]);
    }

    async function addOrder(restaurantId: string, tag: string) {
      const database = await db();
      const stamp = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      await database.query(
        `insert into public.orders (restaurant_id, order_number, status, tracking_token, total, item_count)
         values ($1, $2, 'pending', $3, 100, 1)`,
        [restaurantId, `T-${stamp}`.slice(0, 60), `tok-${stamp}`.slice(0, 80)],
      );
    }

    async function protectedCounts(restaurantId: string) {
      const database = await db();
      const res = await database.query<{ categories: number; menu_items: number; dining_tables: number; qr_tokens: number; settings: number }>(
        `select
           (select count(*) from public.categories where restaurant_id=$1)::int as categories,
           (select count(*) from public.menu_items where restaurant_id=$1)::int as menu_items,
           (select count(*) from public.dining_tables where restaurant_id=$1)::int as dining_tables,
           (select count(*) from public.qr_tokens where restaurant_id=$1)::int as qr_tokens,
           (select count(*) from public.restaurant_settings where restaurant_id=$1)::int as settings`,
        [restaurantId],
      );
      return res.rows[0]!;
    }

    async function orderCount(restaurantId: string) {
      const database = await db();
      const res = await database.query<{ n: number }>(
        "select count(*)::int n from public.orders where restaurant_id = $1",
        [restaurantId],
      );
      return res.rows[0]!.n;
    }

    it("refuses a tenant that is not flagged as a demo", async () => {
      const f = await getFixture();
      await setDemo(f.restaurantId, false);
      await addOrder(f.restaurantId, "nodemo");
      const before = await orderCount(f.restaurantId);

      const preview = await previewDemoReset(f.ownerId, f.restaurantId);
      assert(preview.ok, "preview should work so the UI can explain why reset is disabled");
      assertEquals(preview.preview.isDemo, false, "preview reports non-demo");

      const result = await resetDemoOrders(f.ownerId, f.restaurantId, before, "RESET");
      assertEquals(result.ok, false, "reset must be refused for a live restaurant");
      assertEquals((result as { error: string }).error, "not_demo", "reports not_demo");
      assertEquals(await orderCount(f.restaurantId), before, "no orders were touched");
    });

    it("refuses a wrong confirmation phrase", async () => {
      const f = await getFixture();
      await setDemo(f.restaurantId, true);
      await addOrder(f.restaurantId, "phrase");
      const before = await orderCount(f.restaurantId);

      const result = await resetDemoOrders(f.ownerId, f.restaurantId, before, "please delete");
      assertEquals(result.ok, false, "refused without the exact phrase");
      assertEquals((result as { error: string }).error, "confirmation_mismatch", "reports a mismatch");
      assertEquals(await orderCount(f.restaurantId), before, "nothing deleted");
      await setDemo(f.restaurantId, false);
    });

    it("refuses a stale order count instead of deleting unseen orders", async () => {
      const f = await getFixture();
      await setDemo(f.restaurantId, true);
      await addOrder(f.restaurantId, "stale");
      const actual = await orderCount(f.restaurantId);

      const result = await resetDemoOrders(f.ownerId, f.restaurantId, actual + 1, "RESET");
      assertEquals(result.ok, false, "a mismatched count is refused");
      assertEquals(await orderCount(f.restaurantId), actual, "nothing deleted");
      await setDemo(f.restaurantId, false);
    });

    it("clears orders but never the menu, tables, QR tokens or settings", async () => {
      const f = await getFixture();
      await setDemo(f.restaurantId, true);
      await addOrder(f.restaurantId, "clear");

      const protectedBefore = await protectedCounts(f.restaurantId);
      assert(protectedBefore.menu_items > 0, "fixture has menu items");
      assert(protectedBefore.qr_tokens > 0, "fixture has QR tokens");

      const before = await orderCount(f.restaurantId);
      const result = await resetDemoOrders(f.ownerId, f.restaurantId, before, "RESET");
      assert(result.ok, "reset succeeds for a demo tenant with the right confirmation");

      const protectedAfter = await protectedCounts(f.restaurantId);
      assertEquals(protectedAfter.menu_items, protectedBefore.menu_items, "menu items survive");
      assertEquals(protectedAfter.categories, protectedBefore.categories, "categories survive");
      assertEquals(protectedAfter.dining_tables, protectedBefore.dining_tables, "tables survive");
      assertEquals(protectedAfter.qr_tokens, protectedBefore.qr_tokens, "QR tokens survive");
      assertEquals(protectedAfter.settings, protectedBefore.settings, "settings survive");
      assertEquals(await orderCount(f.restaurantId), 0, "orders are gone");
      assertEquals(result.result.kept.menuItems, protectedBefore.menu_items, "result reports what was kept");
      await setDemo(f.restaurantId, false);
    });

    it("leaves another tenant's orders alone", async () => {
      const f = await getFixture();
      await setDemo(f.restaurantId, true);
      await addOrder(f.restaurantId, "mine");
      await addOrder(f.otherRestaurantId, "theirs");
      const theirs = await orderCount(f.otherRestaurantId);
      assert(theirs > 0, "setup: other tenant has an order");

      const result = await resetDemoOrders(f.ownerId, f.restaurantId, await orderCount(f.restaurantId), "RESET");
      assert(result.ok, "reset succeeds");
      assertEquals(await orderCount(f.otherRestaurantId), theirs, "other tenant untouched");
      await setDemo(f.restaurantId, false);
    });
  });

  for (const [suiteIndex, suite] of suiteStack.entries()) {
    console.log(`  ${suite.name}`);
    for (const test of suite.tests) {
      const t0 = Date.now();
      try {
        await test.fn();
        const ms = Date.now() - t0;
        results.push({ suite: suite.name, name: test.name, ok: true, ms });
        console.log(`    \x1b[32m✓\x1b[0m ${test.name} \x1b[90m(${ms}ms)\x1b[0m`);
      } catch (error) {
        const ms = Date.now() - t0;
        const message = error instanceof Error ? error.message : String(error);
        results.push({ suite: suite.name, name: test.name, ok: false, error: message, ms });
        console.log(`    \x1b[31m✗\x1b[0m ${test.name}`);
        console.log(`      \x1b[31m${message}\x1b[0m`);
        if (error instanceof Error && error.stack) {
          const frame = error.stack.split("\n").find((line) => line.includes("tests/run.ts"));
          if (frame) console.log(`      \x1b[90m${frame.trim()}\x1b[0m`);
        }
      }
    }
    if (suiteIndex < suiteStack.length - 1) console.log("");
  }

  // Security audit suite (tests/security.test.ts). It shares this process and the
  // same database, so "the product suite passed" and "the audit passed" describe
  // the exact same build.
  console.log("  security audit");
  const { runSecuritySuite } = await import("./security.test");
  const audit = await runSecuritySuite({
    onResult(name, ok, ms, error) {
      results.push({ suite: "security audit", name, ok, ms, ...(error ? { error } : {}) });
      if (ok) console.log(`    \x1b[32m✓\x1b[0m ${name} \x1b[90m(${ms}ms)\x1b[0m`);
      else {
        console.log(`    \x1b[31m✗\x1b[0m ${name}`);
        console.log(`      \x1b[31m${error}\x1b[0m`);
      }
    },
  });
  console.log(`\n  security audit: ${audit.passed} passed, ${audit.failed} failed`);

  // Subsystem suite (tests/subsystems.test.ts): storage, email, realtime topics.
  // Same process, same database — these are the modules that talk to Supabase.
  console.log("\n  supabase subsystems");
  const { subsystemSuites } = await import("./subsystems.test");
  for (const test of subsystemSuites()) {
    const t0 = Date.now();
    try {
      await test.fn();
      const ms = Date.now() - t0;
      results.push({ suite: "supabase subsystems", name: test.name, ok: true, ms });
      console.log(`    \x1b[32m✓\x1b[0m ${test.name} \x1b[90m(${ms}ms)\x1b[0m`);
    } catch (error) {
      const ms = Date.now() - t0;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ suite: "supabase subsystems", name: test.name, ok: false, ms, error: message });
      console.log(`    \x1b[31m✗\x1b[0m ${test.name}`);
      console.log(`      \x1b[31m${message}\x1b[0m`);
    }
  }


  await teardown();



  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const duration = Date.now() - started;

  console.log(`\n  ${formatter.format(passed)} passed, ${failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : "0 failed"} · ${(duration / 1000).toFixed(1)}s\n`);
  if (failed > 0) {
    console.log("  Failing tests:");
    for (const failure of results.filter((r) => !r.ok)) {
      console.log(`   • ${failure.suite} › ${failure.name}`);
      console.log(`     ${failure.error}`);
    }
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
