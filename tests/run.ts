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
import { friendlyTransitionError, orderNotifications } from "../src/lib/services/orders";
import { reorderLines } from "../src/lib/customer/order-history";
import { NOTE_LIMIT, NOTE_PRESETS, appendNote } from "../src/components/customer/guest-menu";
import { mapServiceError } from "../src/lib/services/errors";
import { previewDemoReset, resetDemoOrders } from "../src/lib/services/demo-reset";
import { etaState, friendlyReviewError } from "../src/lib/services/reviews";

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

/* ==========================================================================
   Preparation estimate, reviews and service requests
   ========================================================================== */

/** Places an order on the fixture table and returns it with its tracking token. */
async function freshGuestOrder(items?: { menu_item_id: string; quantity: number; note?: string }[]) {
  const f = await getFixture();
  const lines = items ?? [{ menu_item_id: f.itemId, quantity: 2, note: "Less spicy, no onion" }];
  const order = await createOrderAsGuest(f.qrToken, lines, { name: "Review Guest" });
  assert(order.order_id, `order should be created (${order.error ?? "no error"})`);
  return { f, order, token: order.tracking_token! as string, orderId: order.order_id as string };
}

/** Drives an order all the way to served, as the three roles that must. */
async function driveToServed(f: Awaited<ReturnType<typeof getFixture>>, orderId: string, eta?: number) {
  await transition(f.ownerId, orderId, "accepted", undefined, eta ?? null);
  await transition(f.kitchenId, orderId, "preparing");
  await transition(f.kitchenId, orderId, "ready");
  await transition(f.ownerId, orderId, "served");
}

function describeReviewsAndEta() {
  describe("preparation estimate", () => {
    it("is set when the owner accepts, in the same step", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      const result = await transition(f.ownerId, orderId, "accepted", undefined, 20);
      assertEquals(result?.status, "accepted", "order accepted");

      const tracked = await as(ANON, (tx) =>
        tx.query<{ order: { eta_minutes: number; status: string } }>(
          "select public.get_order_tracking($1) as order", [token]));
      assertEquals(tracked.rows[0]!.order.eta_minutes, 20, "guest sees the estimate");
      assertEquals(tracked.rows[0]!.order.status, "accepted", "still accepted, not advanced by the estimate");
    });

    it("shows nothing until the restaurant confirms", async () => {
      const { token } = await freshGuestOrder();
      const tracked = await as(ANON, (tx) =>
        tx.query<{ order: { eta_minutes: number | null } }>("select public.get_order_tracking($1) as order", [token]));
      assertEquals(tracked.rows[0]!.order.eta_minutes, null, "no promise made yet");
    });

    it("refuses an out-of-range estimate", async () => {
      const { f, orderId } = await freshGuestOrder();
      await assertRejects(
        () => transition(f.ownerId, orderId, "accepted", undefined, 999),
        "MP:INVALID_ETA",
        "999 minutes is not a preparation time",
      );
    });

    it("refuses an estimate on a transition that is not acceptance", async () => {
      const { f, orderId } = await freshGuestOrder();
      await transition(f.ownerId, orderId, "accepted", undefined, 15);
      await assertRejects(
        () => transition(f.kitchenId, orderId, "preparing", undefined, 40),
        "MP:ETA_NOT_ALLOWED",
        "preparing cannot carry an estimate",
      );
    });

    it("can be changed while the order is live", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await transition(f.ownerId, orderId, "accepted", undefined, 20);
      await as(asUser(f.ownerId), (tx) =>
        tx.query("select public.set_order_eta($1,$2)", [orderId, 35]));

      const tracked = await as(ANON, (tx) =>
        tx.query<{ order: { eta_minutes: number; eta_revisions: number } }>(
          "select public.get_order_tracking($1) as order", [token]));
      assertEquals(tracked.rows[0]!.order.eta_minutes, 35, "guest sees the new estimate");
      assertEquals(tracked.rows[0]!.order.eta_revisions, 2, "both changes are counted");
    });

    it("refuses an estimate on a pending order", async () => {
      const { f, orderId } = await freshGuestOrder();
      await assertRejects(
        () => as(asUser(f.ownerId), (tx) => tx.query("select public.set_order_eta($1,$2)", [orderId, 20])),
        "MP:ETA_NOT_ALLOWED",
        "nothing has been promised yet",
      );
    });

    it("never marks an order ready when the estimate passes", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await transition(f.ownerId, orderId, "accepted", undefined, 1);
      // Pretend the clock ran out: the order must still be where the kitchen left it.
      await db().then((d) =>
        d.query("update public.orders set preparing_at = now() - interval '90 minutes' where id = $1", [orderId]),
      );
      await transition(f.kitchenId, orderId, "preparing");

      const tracked = await as(ANON, (tx) =>
        tx.query<{ order: { status: string; eta_minutes: number } }>(
          "select public.get_order_tracking($1) as order", [token]));
      assertEquals(tracked.rows[0]!.order.status, "preparing", "an expired estimate does not finish cooking");
      assertEquals(tracked.rows[0]!.order.eta_minutes, 1, "the estimate is still what was promised");
    });

    it("computes lateness without touching the status", () => {
      const stale = etaState({
        status: "preparing",
        eta_minutes: 20,
        accepted_at: new Date(Date.now() - 40 * 60_000).toISOString(),
        preparing_at: new Date(Date.now() - 30 * 60_000).toISOString(),
        ready_at: null,
      });
      assert(stale.overdue, "30 minutes of cooking against a 20 minute estimate is late");
      assert(stale.overdueMinutes >= 9, `lateness is counted (got ${stale.overdueMinutes})`);
      assertEquals(stale.progress, 1, "progress is capped at 100%");

      const waiting = etaState({
        status: "pending", eta_minutes: null, accepted_at: null, preparing_at: null, ready_at: null,
      });
      assert(waiting.waitingForConfirmation, "a pending order has no estimate to count");

      const finished = etaState({
        status: "ready",
        eta_minutes: 20,
        accepted_at: new Date(Date.now() - 60 * 60_000).toISOString(),
        preparing_at: new Date(Date.now() - 50 * 60_000).toISOString(),
        ready_at: new Date().toISOString(),
      });
      assertEquals(finished.overdue, false, "a finished order is not 'late', it is done");
    });
  });

  describe("reviews", () => {
    it("refuses a review before the order is served", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await transition(f.ownerId, orderId, "accepted", undefined, 20);
      await assertRejects(
        () => as(ANON, (tx) =>
          tx.query("select public.submit_review($1,'item',$2,5,'great',null,null,null,null,null,null,null)", [token, f.itemId])),
        "MP:REVIEW_NOT_ELIGIBLE",
        "an accepted order is not a finished experience",
      );
    });

    it("accepts a dish review once the order is served", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);

      const res = await as(ANON, (tx) =>
        tx.query<{ result: { id: string; item_name: string } }>(
          "select public.submit_review($1,'item',$2,5,'Excellent',$3,$4,$5,null,null,null,null) as result",
          [token, f.itemId, 5, 4, 5]));
      assert(res.rows[0]!.result.id, "review stored");
      assertEquals(res.rows[0]!.result.item_name, "Test Biryani", "the dish is named back");
    });

    it("refuses a second review of the same dish", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);
      const sql = "select public.submit_review($1,'item',$2,5,null,null,null,null,null,null,null,null)";
      await as(ANON, (tx) => tx.query(sql, [token, f.itemId]));
      await assertRejects(
        () => as(ANON, (tx) => tx.query(sql, [token, f.itemId])),
        "MP:REVIEW_DUPLICATE_ITEM",
        "one review per dish per order",
      );
    });

    it("refuses a dish that was not on the order", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);
      await assertRejects(
        () => as(ANON, (tx) =>
          tx.query("select public.submit_review($1,'item',$2,5,null,null,null,null,null,null,null,null)", [token, f.otherItemId])),
        "MP:ITEM_NOT_ON_ORDER",
        "a guest cannot review food they did not buy",
      );
    });

    it("accepts one visit review and refuses a second", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);
      const sql = "select public.submit_review($1,'restaurant',null,4,'Lovely',null,null,null,$2,$3,$4,null)";
      await as(ANON, (tx) => tx.query(sql, [token, 5, 4, 4]));
      await assertRejects(
        () => as(ANON, (tx) => tx.query(sql, [token, 3, 3, 3])),
        "MP:REVIEW_DUPLICATE_RESTAURANT",
        "one visit review per order",
      );
    });

    it("refuses a review with an invalid tracking token", async () => {
      const fake = "f".repeat(48);
      await assertRejects(
        () => as(ANON, (tx) =>
          tx.query("select public.submit_review($1,'restaurant',null,5,null,null,null,null,null,null,null,null)", [fake])),
        "MP:INVALID_TRACKING",
        "a guessed token reviews nothing",
      );
    });

    it("does not let another tenant's guest review this restaurant", async () => {
      const f = await getFixture();
      const other = await createOrderAsGuest(f.otherQrToken, [{ menu_item_id: f.otherItemId, quantity: 1 }]);
      assert(other.order_id, "other tenant order created");
      await as(asUser(f.otherOwnerId), (tx) =>
        tx.query("select public.transition_order($1,'accepted',null,$2)", [other.order_id, 10]));
      await as(asUser(f.otherOwnerId), (tx) =>
        tx.query("select public.transition_order($1,'preparing',null,null)", [other.order_id]));
      await as(asUser(f.otherOwnerId), (tx) =>
        tx.query("select public.transition_order($1,'ready',null,null)", [other.order_id]));
      await as(asUser(f.otherOwnerId), (tx) =>
        tx.query("select public.transition_order($1,'served',null,null)", [other.order_id]));

      await as(ANON, (tx) =>
        tx.query("select public.submit_review($1,'restaurant',null,5,'other tenant',null,null,null,null,null,null,null)",
          [other.tracking_token]));

      // The review landed on the other tenant and is invisible to this one.
      const summaries = await as(asUser(f.ownerId), (tx) =>
        tx.query<{ result: { restaurant: { count: number }; recent: { order_number: string }[] } }>(
          "select public.restaurant_reviews($1) as result", [f.restaurantId]));
      const mine = summaries.rows[0]!.result;
      assert(
        mine.recent.every((row) => row.order_number !== other.order_number),
        "another tenant's review never appears here",
      );
    });

    it("lets the owner reply and hides without deleting", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);
      const created = await as(ANON, (tx) =>
        tx.query<{ result: { id: string } }>(
          "select public.submit_review($1,'restaurant',null,2,'Slow service',null,null,$2,$3,$4,null) as result",
          [token, 2, 3, 2]));

      const reviewId = created.rows[0]!.result.id;
      const replied = await as(asUser(f.ownerId), (tx) =>
        tx.query<{ result: { body: string } }>(
          "select public.reply_to_review($1,$2) as result", [reviewId, "Sorry — we were short staffed."]));
      assert(replied.rows[0]!.result.body.includes("short staffed"), "reply stored");

      await as(asUser(f.ownerId), (tx) =>
        tx.query("select public.set_review_hidden($1,$2,$3)", [reviewId, true, "Abusive language"]));

      const summary = await as(asUser(f.ownerId), (tx) =>
        tx.query<{ result: { recent: { id: string; is_hidden: boolean }[] } }>(
          "select public.restaurant_reviews($1) as result", [f.restaurantId]));
      const row = summary.rows[0]!.result.recent.find((r) => r.id === reviewId);
      assert(row, "a hidden review is still visible to the owner");
      assertEquals(row!.is_hidden, true, "and is marked hidden rather than gone");
    });

    it("keeps a hidden review out of public view", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);
      const created = await as(ANON, (tx) =>
        tx.query<{ result: { id: string } }>(
          "select public.submit_review($1,'restaurant',null,1,null,null,null,null,null,null,null,null) as result", [token]));
      const reviewId = created.rows[0]!.result.id;

      // The fixture tenant is shared by this suite, so measure the delta rather
      // than assuming a total.
      const countFor = async () =>
        (await as(ANON, (tx) =>
          tx.query<{ result: { restaurant: { count: number } } }>(
            "select public.restaurant_reviews($1) as result", [f.restaurantId]))).rows[0]!.result.restaurant.count;

      const publicBefore = await countFor();
      await as(asUser(f.ownerId), (tx) =>
        tx.query("select public.set_review_hidden($1,true,$2)", [reviewId, "Spam"]));
      const publicAfter = await countFor();
      assertEquals(publicAfter, publicBefore - 1, "the public view drops a hidden review");

      // Staff still see it, flagged — hiding is not deleting.
      const staffView = await as(asUser(f.ownerId), (tx) =>
        tx.query<{ result: { recent: { id: string; is_hidden: boolean }[] } }>(
          "select public.restaurant_reviews($1) as result", [f.restaurantId]));
      const hiddenRow = staffView.rows[0]!.result.recent.find((row) => row.id === reviewId);
      assert(hiddenRow && hiddenRow.is_hidden, "the owner still sees the hidden review");
    });

    it("does not let a manager of another tenant reply", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);
      const created = await as(ANON, (tx) =>
        tx.query<{ result: { id: string } }>(
          "select public.submit_review($1,'restaurant',null,4,null,null,null,null,null,null,null,null) as result", [token]));
      await assertRejects(
        () => as(asUser(f.otherOwnerId), (tx) =>
          tx.query("select public.reply_to_review($1,$2)", [created.rows[0]!.result.id, "Not mine"])),
        "MP:FORBIDDEN",
        "replies are scoped to the tenant",
      );
    });
  });

  describe("service requests", () => {
    it("raises a request against the guest's own table", async () => {
      const { token } = await freshGuestOrder();
      const res = await as(ANON, (tx) =>
        tx.query<{ result: { id: string; status: string } }>(
          "select public.request_service($1,'water',null) as result", [token]));
      assertEquals(res.rows[0]!.result.status, "pending", "queued for staff");
    });

    it("refuses a duplicate open request of the same kind", async () => {
      const { token } = await freshGuestOrder();
      await as(ANON, (tx) => tx.query("select public.request_service($1,'waiter',null)", [token]));
      await assertRejects(
        () => as(ANON, (tx) => tx.query("select public.request_service($1,'waiter',null)", [token])),
        "MP:REQUEST_ALREADY_OPEN",
        "one open request per kind",
      );
    });

    it("allows a different kind while one is open", async () => {
      const { token } = await freshGuestOrder();
      await as(ANON, (tx) => tx.query("select public.request_service($1,'waiter',null)", [token]));
      const second = await as(ANON, (tx) =>
        tx.query<{ result: { status: string } }>("select public.request_service($1,'bill',null) as result", [token]));
      assertEquals(second.rows[0]!.result.status, "pending", "asking for the bill is a separate errand");
    });

    it("moves pending → acknowledged → completed and stops there", async () => {
      const { f, token } = await freshGuestOrder();
      const created = await as(ANON, (tx) =>
        tx.query<{ result: { id: string } }>("select public.request_service($1,'plate',null) as result", [token]));
      const id = created.rows[0]!.result.id;

      await as(asUser(f.kitchenId), (tx) => tx.query("select public.set_service_status($1,'acknowledged')", [id]));
      await as(asUser(f.managerId), (tx) => tx.query("select public.set_service_status($1,'completed')", [id]));
      await assertRejects(
        () => as(asUser(f.managerId), (tx) => tx.query("select public.set_service_status($1,'acknowledged')", [id])),
        "MP:REQUEST_CLOSED",
        "a finished request is finished",
      );
    });

    it("keeps the request board away from guests", async () => {
      const f = await getFixture();
      await assertRejects(
        () => as(ANON, (tx) => tx.query("select public.service_board($1)", [f.restaurantId])),
        "MP:FORBIDDEN",
        "the board is staff-only",
      );
    });

    it("shows the request to staff of that tenant only", async () => {
      const { f, token } = await freshGuestOrder();
      await as(ANON, (tx) => tx.query("select public.request_service($1,'waiter','At the window')", [token]));

      const board = await as(asUser(f.ownerId), (tx) =>
        tx.query<{ board: { kind: string; body: string; table_label: string }[] }>(
          "select public.service_board($1) as board", [f.restaurantId]));
      const mine = board.rows[0]!.board.filter((row) => row.body === "At the window");
      assertEquals(mine.length, 1, "the request is on this tenant's board");

      const otherBoard = await as(asUser(f.otherOwnerId), (tx) =>
        tx.query<{ board: { body: string }[] }>("select public.service_board($1) as board", [f.otherRestaurantId]));
      assert(
        otherBoard.rows[0]!.board.every((row) => row.body !== "At the window"),
        "another tenant never sees it",
      );
    });
  });

  describe("guest-facing reply", () => {
    it("shows the restaurant's reply on the guest's own tracker", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);
      const created = await as(ANON, (tx) =>
        tx.query<{ result: { id: string } }>(
          "select public.submit_review($1,'restaurant',null,5,'Great night',null,null,null,5,5,5,null) as result",
          [token]));
      await as(asUser(f.ownerId), (tx) =>
        tx.query("select public.reply_to_review($1,$2)", [created.rows[0]!.result.id, "Thank you for coming!"]));

      const tracked = await as(ANON, (tx) =>
        tx.query<{ order: { reviews: { mine: { kind: string; reply: string | null }[] } } }>(
          "select public.get_order_tracking($1) as order", [token]));
      const visit = tracked.rows[0]!.order.reviews.mine.find((row) => row.kind === "restaurant");
      assert(visit, "the guest sees their own review");
      assertEquals(visit!.reply, "Thank you for coming!", "with the reply attached");
    });

    it("gives a role-denied message that says so", async () => {
      const { f, orderId, token } = await freshGuestOrder();
      await driveToServed(f, orderId);
      const created = await as(ANON, (tx) =>
        tx.query<{ result: { id: string } }>(
          "select public.submit_review($1,'restaurant',null,4,null,null,null,null,null,null,null,null) as result", [token]));
      const message = await assertRejects(
        () => as(asUser(f.kitchenId), (tx) =>
          tx.query("select public.reply_to_review($1,$2)", [created.rows[0]!.result.id, "Not my job"])),
        "MP:FORBIDDEN",
        "kitchen cannot reply",
      );
      assertEquals(friendlyReviewError(message), "Your role cannot do that.", "and the copy is specific");
    });
  });

  describe("guest activity feed", () => {
    const base = {
      status: "pending",
      placed_at: "2026-11-08T10:00:00Z",
      accepted_at: null,
      preparing_at: null,
      ready_at: null,
      served_at: null,
      rejected_at: null,
      rejection_reason: null,
      eta_minutes: null,
      eta_revisions: 0,
    };

    it("newest event first, and only what already happened", () => {
      const feed = orderNotifications({
        ...base,
        status: "ready",
        accepted_at: "2026-11-08T10:05:00Z",
        preparing_at: "2026-11-08T10:07:00Z",
        ready_at: "2026-11-08T10:20:00Z",
        eta_minutes: 15,
      });
      assertEquals(feed.map((event) => event.key).join(","), "ready,preparing,accepted,placed", "reverse chronological");
      assertEquals(feed[0]!.title, "Ready and coming to your table", "with guest-facing copy");
      assert(feed.every((event) => event.at !== null), "no future rows are rendered");
    });

    it("says what the kitchen expects once an estimate exists", () => {
      const feed = orderNotifications({ ...base, status: "accepted", accepted_at: "2026-11-08T10:05:00Z", eta_minutes: 25 });
      const accepted = feed.find((event) => event.key === "accepted");
      assert(accepted!.detail.includes("25 minutes"), "the estimate is quoted");
    });

    it("does not repeat the first estimate as a revision", () => {
      const feed = orderNotifications({
        ...base,
        status: "accepted",
        accepted_at: "2026-11-08T10:05:00Z",
        eta_minutes: 20,
        eta_revisions: 1,
      });
      assert(!feed.some((event) => event.key === "eta-revised"), "acceptance announces the estimate once");
    });

    it("explains a changed estimate as its own event", () => {
      const feed = orderNotifications({
        ...base,
        status: "preparing",
        accepted_at: "2026-11-08T10:05:00Z",
        preparing_at: "2026-11-08T10:06:00Z",
        eta_minutes: 40,
        eta_revisions: 2,
      });
      const revised = feed.find((event) => event.key === "eta-revised");
      assert(revised, "a revision is surfaced");
      assert(revised!.detail.includes("40 minutes"), "with the new number");
      const accepted = feed.find((event) => event.key === "accepted");
      assert(!accepted!.detail.includes("40 minutes"), "acceptance does not quote the rewritten number");
    });

    it("reports a rejection and stops there", () => {
      const feed = orderNotifications({
        ...base,
        status: "rejected",
        rejected_at: "2026-11-08T10:02:00Z",
        rejection_reason: "Kitchen just closed",
      });
      assertEquals(feed.map((event) => event.key).join(","), "rejected,placed", "no invented cooking steps");
      assertEquals(feed[0]!.detail, "Kitchen just closed", "with the restaurant's reason");
      assertEquals(feed[0]!.tone, "warn", "flagged for attention");
    });

    it("surfaces the restaurant's reply in the feed", () => {
      const feed = orderNotifications({
        ...base,
        status: "served",
        accepted_at: "2026-11-08T10:05:00Z",
        served_at: "2026-11-08T10:30:00Z",
        reviews: {
          mine: [
            { kind: "restaurant", reply: "Thanks for coming!", reply_at: "2026-11-08T11:00:00Z", item_name: null },
            { kind: "item", reply: null, reply_at: null, item_name: "Beef Bhuna" },
          ],
        },
      });
      const reply = feed.find((event) => event.key === "reply-restaurant");
      assert(reply, "the reply appears as an event");
      assertEquals(reply!.detail, "Thanks for coming!", "verbatim");
      assertEquals(feed[0]!.key, "reply-restaurant", "and it is the newest thing that happened");
    });
  });

  describe("preset instruction chips", () => {
    it("appends a preset to what the guest already typed", () => {
      assertEquals(appendNote("", "No onion"), "No onion", "empty note becomes the preset");
      assertEquals(appendNote("Birthday plate", "Extra spicy"), "Birthday plate, Extra spicy", "own words are kept");
    });

    it("never duplicates a preset, and tolerates a trailing comma", () => {
      assertEquals(appendNote("No onion, Extra spicy", "No onion"), "No onion, Extra spicy", "tapping twice is idempotent");
      assertEquals(appendNote("No onion,", "Extra spicy"), "No onion, Extra spicy", "no double comma");
      assertEquals(appendNote("no onion", "No onion"), "no onion", "case-insensitive match");
    });

    it("respects the 200 character note limit", () => {
      const full = "x".repeat(NOTE_LIMIT);
      assertEquals(appendNote(full, "No onion").length, NOTE_LIMIT, "never overflows the column");
      assert(NOTE_PRESETS.length <= 8, "the chip row still fits on a phone");
    });
  });

  describe("reorder from history", () => {
    it("maps a past order back onto live menu ids", () => {
      const { lines, unavailable } = reorderLines(
        [
          { menuItemId: "a", name: "Beef Bhuna", quantity: 2, note: "Extra spicy" },
          { menuItemId: "b", name: "Lassi", quantity: 1 },
        ],
        [{ id: "a", name: "Beef Bhuna" }, { id: "b", name: "Lassi" }],
      );
      assertEquals(lines.length, 2, "both lines restored");
      assertEquals(lines[0]!.note, "Extra spicy", "and the guest's note survives");
      assertEquals(unavailable.length, 0, "nothing dropped");
    });

    it("drops dishes that have left the menu and names them", () => {
      const { lines, unavailable } = reorderLines(
        [{ menuItemId: "gone", name: "Discontinued Curry", quantity: 1 }],
        [{ id: "a", name: "Beef Bhuna" }],
      );
      assertEquals(lines.length, 0, "a ghost line is never added to the cart");
      assertEquals(unavailable.join(","), "Discontinued Curry", "the guest is told which dish went");
    });

    it("clamps absurd quantities instead of trusting storage", () => {
      const { lines } = reorderLines(
        [{ menuItemId: "a", name: "Beef Bhuna", quantity: 5000 }],
        [{ id: "a", name: "Beef Bhuna" }],
      );
      assertEquals(lines[0]!.quantity, 99, "capped at the menu limit");
    });
  });

  describe("kitchen item preparation", () => {
    it("ticks a line off only after the owner accepted", async () => {
      const { f, orderId } = await freshGuestOrder();
      const lines = await db().then((d) =>
        d.query<{ id: string }>("select id from public.order_items where order_id = $1", [orderId]));

      await assertRejects(
        () => as(asUser(f.kitchenId), (tx) => tx.query("select public.set_item_prep($1,'done')", [lines.rows[0]!.id])),
        "MP:PREP_NOT_ALLOWED",
        "a pending order is not being cooked",
      );

      await transition(f.ownerId, orderId, "accepted", undefined, 20);
      const done = await as(asUser(f.kitchenId), (tx) =>
        tx.query<{ result: { status: string } }>("select public.set_item_prep($1,'done') as result", [lines.rows[0]!.id]));
      assertEquals(done.rows[0]!.result.status, "done", "line ticked");
    });

    it("carries the estimate and line state to the kitchen feed", async () => {
      const { f, orderId } = await freshGuestOrder();
      await transition(f.ownerId, orderId, "accepted", undefined, 25);

      const feed = await as(asUser(f.kitchenId), (tx) =>
        tx.query<{ tickets: { id: string; eta_minutes: number; items: { prep_status: string }[] }[] }>(
          "select public.kitchen_feed($1) as tickets", [f.restaurantId]));
      const ticket = feed.rows[0]!.tickets.find((t) => t.id === orderId);
      assert(ticket, "the accepted order is on the pass");
      assertEquals(ticket!.eta_minutes, 25, "with the promise attached");
      assertEquals(ticket!.items[0]!.prep_status, "queued", "and its lines unticked");
    });
  });
}

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

  describeReviewsAndEta();

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
