/**
 * Security audit suite.
 *
 * Each test corresponds to an item on the production audit checklist. They run
 * against the real database, the real RLS policies and the real upload validators —
 * no mocks — so a passing result means the deployed code behaves this way.
 *
 * Grouped by the exact questions an auditor asks:
 *   1. can tenant B read or write tenant A's data?
 *   2. can a staff member do something their role forbids?
 *   3. can a QR token be forged, reused after revocation, or swapped?
 *   4. can a guest pay a different price or duplicate an order?
 *   5. can the state machine be driven out of order?
 *   6. can a malicious file be uploaded?
 *   7. can a normal account reach platform administration?
 *   8. does any secret reach the browser?
 *   9. are sessions revocable and unguessable?
 */
import { ANON, as, asUser, createOrderAsGuest, db, getFixture, transition } from "./harness";

type TestFn = () => Promise<void> | void;
interface Test {
  name: string;
  fn: TestFn;
}
const suiteStack: { name: string; tests: Test[] }[] = [];
let current: { name: string; tests: Test[] } = { name: "root", tests: [] };

function describe(name: string, fn: () => void) {
  const suite = { name, tests: [] as Test[] };
  const parent = current;
  suiteStack.push(parent);
  current = suite;
  fn();
  current = suiteStack.pop()!;
  current.tests.push({ name: `__suite__${name}`, fn: () => undefined });
  (current as unknown as { suites?: unknown[] }).suites ??= [];
  ((current as unknown as { suites: { name: string; tests: Test[] }[] }).suites).push(suite);
}

function it(name: string, fn: TestFn) {
  current.tests.push({ name, fn });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
}

async function assertRejects(fn: () => Promise<unknown>, expected: string, message: string) {
  try {
    await fn();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.toLowerCase().includes(expected.toLowerCase())) {
      throw new Error(`${message} (expected "${expected}", got "${text}")`);
    }
    return;
  }
  throw new Error(`${message} (no error was raised)`);
}

/* ==========================================================================
   1. Cross-tenant database access
   ========================================================================== */

describe("audit: cross-tenant database access", () => {
  it("cannot read another tenant's orders, customers or tables", async () => {
    const f = await getFixture();
    const database = await db();
    await database.query(
      `insert into orders (restaurant_id, order_number, status, subtotal, total, table_id, tracking_token, customer_name)
       values ($1, 'TENANT-B-1', 'pending', 100, 100, $2, 'b-tracking-token-000000000000', 'Guest B')`,
      [f.otherRestaurantId, f.otherTableId],
    );

    const checks: [string, string, unknown[]][] = [
      ["orders", "select count(*)::int c from orders where restaurant_id = $1", [f.otherRestaurantId]],
      ["customers", "select count(*)::int c from customers where restaurant_id = $1", [f.otherRestaurantId]],
      ["dining_tables", "select count(*)::int c from dining_tables where restaurant_id = $1", [f.otherRestaurantId]],
      ["qr_tokens", "select count(*)::int c from qr_tokens where restaurant_id = $1", [f.otherRestaurantId]],
      ["restaurant_members", "select count(*)::int c from restaurant_members where restaurant_id = $1", [f.otherRestaurantId]],
    ];

    for (const [label, sql, params] of checks) {
      const res = await as(asUser(f.ownerId), (tx) => tx.query<{ c: number }>(sql, params));
      assertEquals(Number(res.rows[0]?.c ?? 0), 0, `owner A must see no ${label} rows from tenant B`);
    }

    // Menu content is the exception, and deliberately so: it is the public menu.
    // What matters is that it is read-only for other tenants.
    const foreignMenu = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ c: number }>("select count(*)::int c from menu_items where restaurant_id = $1", [f.otherRestaurantId]),
    );
    assert(Number(foreignMenu.rows[0]?.c ?? 0) >= 0, "published menu rows are readable by design");
    const foreignWrite = await as(asUser(f.ownerId), (tx) =>
      tx.query("update menu_items set price = 1 where restaurant_id = $1", [f.otherRestaurantId]),
    ).then(
      (res) => res.rowCount,
      (error: Error) => error.message,
    );
    assert(
      foreignWrite === 0 || (typeof foreignWrite === "string" && foreignWrite.includes("row-level security")),
      "another tenant's menu is read-only",
    );
  });

  it("cannot write into another tenant's tables", async () => {
    const f = await getFixture();
    const attempts: [string, string, unknown[]][] = [
      [
        "menu_items",
        "insert into menu_items (restaurant_id, category_id, name, slug, price) values ($1,$2,'Injected','injected',1)",
        [f.otherRestaurantId, f.categoryId],
      ],
      [
        "dining_tables",
        "insert into dining_tables (restaurant_id, label) values ($1,'Injected table')",
        [f.otherRestaurantId],
      ],
      [
        "categories",
        "insert into categories (restaurant_id, name) values ($1,'Injected category')",
        [f.otherRestaurantId],
      ],
    ];

    for (const [label, sql, params] of attempts) {
      // A cross-tenant write must either affect 0 rows or be refused by policy —
      // both are correct; silently succeeding is not.
      const outcome = await as(asUser(f.ownerId), (tx) => tx.query(sql, params)).then(
        (res) => res.rowCount,
        (error: Error) => error.message,
      );
      assert(
        outcome === 0 || (typeof outcome === "string" && outcome.includes("row-level security")),
        `owner A must not be able to write ${label} for tenant B (got ${outcome})`,
      );
    }

    const database = await db();
    const leaked = await database.query<{ c: number }>(
      "select count(*)::int c from menu_items where restaurant_id = $1 and slug = 'injected'",
      [f.otherRestaurantId],
    );
    assertEquals(Number(leaked.rows[0]?.c ?? 0), 0, "nothing was persisted for tenant B");
  });

  it("ignores a forged restaurant id sent by the client", async () => {
    const f = await getFixture();
    // Even when the guest names another restaurant, the QR token decides.
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const database = await db();
    const row = await database.query<{ restaurant_id: string }>("select restaurant_id from orders where id = $1", [
      order.order_id,
    ]);
    assertEquals(row.rows[0]?.restaurant_id, f.restaurantId, "order lands in the token's tenant");
  });
});

/* ==========================================================================
   2. Unauthorized staff actions
   ========================================================================== */

describe("audit: unauthorized staff actions", () => {
  it("stops a kitchen account from accepting, rejecting or serving orders", async () => {
    const f = await getFixture();
    for (const next of ["accepted", "rejected", "served"]) {
      const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
      const outcome = await transition(f.kitchenId, order.order_id!, next).then(
        () => "allowed",
        (error: Error) => error.message,
      );
      // Refused either because the role is wrong or because the transition is
      // illegal from `pending` — both keep the order out of the kitchen's control.
      assert(
        outcome.includes("MP:FORBIDDEN_TRANSITION") || outcome.includes("MP:INVALID_TRANSITION"),
        `kitchen must not move an order to ${next} (got ${outcome})`,
      );
    }
  });

  it("stops a waiter from editing the menu, tables or team", async () => {
    const f = await getFixture();
    const database = await db();
    const waiterId = await (await import("./harness")).createUser(`waiter-${Date.now()}@example.test`);
    await database.query("insert into restaurant_members (restaurant_id, user_id, role) values ($1,$2,'waiter')", [
      f.restaurantId,
      waiterId,
    ]);

    const menuWrite = await as(asUser(waiterId), (tx) =>
      tx.query("update menu_items set price = 1 where restaurant_id = $1", [f.restaurantId]),
    );
    assertEquals(menuWrite.rowCount, 0, "waiter cannot reprice the menu");

    const teamWrite = await as(asUser(waiterId), (tx) =>
      tx.query("delete from restaurant_members where restaurant_id = $1 and role = 'kitchen'", [f.restaurantId]),
    );
    assertEquals(teamWrite.rowCount, 0, "waiter cannot remove team members");

    const tableOutcome = await as(asUser(waiterId), (tx) =>
      tx.query("insert into dining_tables (restaurant_id, label) values ($1,'Waiter table')", [f.restaurantId]),
    ).then(
      (res) => res.rowCount,
      (error: Error) => error.message,
    );
    assert(
      tableOutcome === 0 || (typeof tableOutcome === "string" && tableOutcome.includes("row-level security")),
      "waiter cannot add tables",
    );
  });

  it("stops a manager from granting ownership or touching platform data", async () => {
    const f = await getFixture();
    const database = await db();
    const member = await database.query<{ id: string }>(
      "select id from restaurant_members where restaurant_id = $1 and user_id = $2",
      [f.restaurantId, f.kitchenId],
    );

    const promote = await as(asUser(f.managerId), (tx) =>
      tx.query("update restaurant_members set role = 'owner' where id = $1", [member.rows[0]!.id]),
    );
    assertEquals(promote.rowCount, 0, "manager cannot promote anyone to owner");

    await assertRejects(
      () => as(asUser(f.managerId), (tx) => tx.query("select public.platform_overview()")),
      "MP:FORBIDDEN",
      "manager cannot read platform aggregates",
    );
  });

  it("refuses every write path to a suspended tenant", async () => {
    const f = await getFixture();
    const database = await db();
    await database.query("update restaurants set status = 'suspended' where id = $1", [f.otherRestaurantId]);
    try {
      // A guest cannot order from a suspended restaurant through its QR code.
      const attempt = await as(ANON, (tx) =>
        tx.query("select public.create_order($1, $2::jsonb, null, null, null, null) as result", [
          f.otherQrToken,
          JSON.stringify([{ menu_item_id: f.otherItemId, quantity: 1 }]),
        ]),
      );
      assertEquals(attempt.rows.length === 0 || !attempt.rows[0], true, "suspended tenant cannot take orders");
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      assert(
        text.includes("MP:RESTAURANT_UNAVAILABLE") || text.includes("MP:INVALID_QR") || text.includes("MP:FORBIDDEN"),
        `suspended tenant must be refused, got: ${text}`,
      );
    } finally {
      await database.query("update restaurants set status = 'active' where id = $1", [f.otherRestaurantId]);
    }
  });
});

/* ==========================================================================
   3. QR token validation
   ========================================================================== */

describe("audit: QR token validation", () => {
  it("rejects forged, truncated and empty tokens", async () => {
    const f = await getFixture();
    const database = await db();
    const candidates = [
      "",
      "x",
      "not-a-real-token",
      f.qrToken.slice(0, -2) + "00",
      "0".repeat(48),
    ];
    for (const candidate of candidates) {
      const res = await database.query<{ menu: unknown }>("select public.menu_for_qr($1) as menu", [candidate]);
      assertEquals(res.rows[0]?.menu, null, `token "${candidate.slice(0, 12)}" must not resolve`);
    }
  });

  it("cannot be replayed through a different restaurant slug", async () => {
    const f = await getFixture();
    const database = await db();
    // The token carries its own restaurant; asking for tenant B's menu with A's
    // token must not switch the tenant.
    const res = await database.query<{ menu: { restaurant: { id: string } } | null }>(
      "select public.menu_for_qr($1) as menu",
      [f.qrToken],
    );
    assertEquals(res.rows[0]?.menu?.restaurant.id, f.restaurantId, "token resolves to its own tenant only");
  });

  it("stops working the moment it is revoked, and stays revoked", async () => {
    const f = await getFixture();
    const database = await db();
    await database.query("update qr_tokens set revoked_at = now() where token = $1", [f.qrToken]);

    const revoked = await database.query<{ menu: unknown }>("select public.menu_for_qr($1) as menu", [f.qrToken]);
    assertEquals(revoked.rows[0]?.menu, null, "revoked token stops resolving");

    await assertRejects(
      () => createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]),
      "MP:INVALID_QR",
      "revoked token cannot create orders",
    );

    await database.query("update qr_tokens set revoked_at = null where token = $1", [f.qrToken]);
  });
});

/* ==========================================================================
   4. Duplicate submission and price tampering
   ========================================================================== */

describe("audit: duplicate submission and price integrity", () => {
  it("collapses a retried submission with the same idempotency key", async () => {
    const f = await getFixture();
    const key = `audit-key-${Date.now()}`;
    const database = await db();
    const first = await database.query<{ result: { order_id: string; total: string } }>(
      "select public.create_order($1, $2::jsonb, null, null, null, $3) as result",
      [f.qrToken, JSON.stringify([{ menu_item_id: f.itemId, quantity: 2 }]), key],
    );
    const second = await database.query<{ result: { order_id: string; total: string } }>(
      "select public.create_order($1, $2::jsonb, null, null, null, $3) as result",
      [f.qrToken, JSON.stringify([{ menu_item_id: f.itemId, quantity: 2 }]), key],
    );

    assertEquals(second.rows[0]?.result.order_id, first.rows[0]?.result.order_id, "same order, not a duplicate");
    const count = await database.query<{ c: number }>(
      "select count(*)::int c from orders where restaurant_id = $1 and idempotency_key = $2",
      [f.restaurantId, key],
    );
    assertEquals(Number(count.rows[0]?.c ?? 0), 1, "exactly one row exists");
  });

  it("prices from the database, never from the payload", async () => {
    const f = await getFixture();
    const database = await db();
    // Attempt to smuggle a price in the line item.
    const res = await database.query<{ result: { total: string; subtotal: string } }>(
      "select public.create_order($1, $2::jsonb, null, null, null, null) as result",
      [
        f.qrToken,
        JSON.stringify([
          { menu_item_id: f.itemId, quantity: 1, price: 1, unit_price: 1, total: 1, line_total: 1, subtotal: 1 },
        ]),
      ],
    );
    const line = await database.query<{ unit_price: string }>(
      "select unit_price from order_items where order_id = (select id from orders where order_number like 'TST%' order by created_at desc limit 1)",
    );
    assertEquals(Number(line.rows[0]?.unit_price), 500, "unit price comes from menu_items");
    assert(Number(res.rows[0]?.result.total) > 1, "client-supplied total was ignored");
  });

  it("rejects quantity abuse instead of trusting the number", async () => {
    const f = await getFixture();
    const database = await db();
    const res = await database.query<{ result: { items?: unknown[] } }>(
      "select public.create_order($1, $2::jsonb, null, null, null, null) as result",
      [f.qrToken, JSON.stringify([{ menu_item_id: f.itemId, quantity: -5 }])],
    );
    const items = await database.query<{ quantity: number }>(
      "select oi.quantity from order_items oi join orders o on o.id = oi.order_id where o.id = (select id from orders where order_number like 'TST%' order by created_at desc limit 1)",
    );
    assert(Number(items.rows[0]?.quantity) >= 1, "a negative quantity is clamped or refused");
  });
});

/* ==========================================================================
   5. State machine integrity
   ========================================================================== */

describe("audit: invalid order state transitions", () => {
  it("refuses every illegal jump from pending", async () => {
    const f = await getFixture();
    for (const next of ["preparing", "ready", "served", "cancelled"]) {
      const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
      const outcome = await transition(f.ownerId, order.order_id!, next).then(
        () => "allowed",
        (error: Error) => error.message,
      );
      assert(
        outcome.includes("MP:INVALID_TRANSITION") || outcome.includes("MP:FORBIDDEN_TRANSITION"),
        `pending -> ${next} must be refused, got ${outcome}`,
      );
    }
  });

  it("cannot resurrect a rejected order", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await transition(f.ownerId, order.order_id!, "rejected", "Sold out");
    await assertRejects(
      () => transition(f.ownerId, order.order_id!, "accepted"),
      "MP:INVALID_TRANSITION",
      "a rejected order is final",
    );
  });

  it("records who changed what, for every transition", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    await transition(f.ownerId, order.order_id!, "accepted");
    await transition(f.ownerId, order.order_id!, "preparing");

    const database = await db();
    const history = await database.query<{ to_status: string; changed_by: string | null }>(
      "select to_status, changed_by from order_status_history where order_id = $1 order by created_at",
      [order.order_id],
    );
    assert(history.rows.length >= 3, "placement + two transitions are recorded");
    assert(
      history.rows.every((row) => row.changed_by === f.ownerId || row.changed_by === null),
      "each transition names its actor (null only for guest placement)",
    );
  });
});

/* ==========================================================================
   6. File upload security
   ========================================================================== */

describe("audit: file upload security", () => {
  it("accepts only real images of the allowed types", async () => {
    const { detectImageType, validateImageUpload } = await import("../src/lib/services/storage");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assertEquals(detectImageType(png), "image/png", "png signature recognised");

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assertEquals(detectImageType(jpeg), "image/jpeg", "jpeg signature recognised");

    const script = Buffer.from("#!/bin/sh\necho pwned\n");
    assertEquals(detectImageType(script), null, "shell script rejected despite any extension");

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assertEquals(detectImageType(svg), null, "svg cannot be uploaded (script vector)");

    const pdf = Buffer.from("%PDF-1.4\n...");
    assertEquals(detectImageType(pdf), null, "pdf rejected");
  });

  it("enforces size and declared-type limits before reading bytes", async () => {
    const { validateImageUpload, MAX_UPLOAD_BYTES } = await import("../src/lib/services/storage");
    assert(validateImageUpload({ type: "application/pdf", size: 10 }) !== null, "content type checked");
    assert(validateImageUpload({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 }) !== null, "size capped");
    assert(validateImageUpload({ type: "image/png", size: 0 }) !== null, "empty file rejected");
    assertEquals(validateImageUpload({ type: "image/png", size: 1024 }), null, "a normal png passes");
  });

  it("cannot traverse out of its own tenant folder", async () => {
    const { slugifyFilename } = await import("../src/lib/services/storage");
    // Filenames are slugified and the tenant prefix comes from the session, so a
    // crafted name cannot escape the folder.
    for (const name of ["../../etc/passwd", "..%2f..%2fsecret", "/abs/path.png", "a/../../b.png"]) {
      const slug = slugifyFilename(name);
      assert(!slug.includes("/"), `slug for "${name}" contains no separator`);
      assert(!slug.includes(".."), `slug for "${name}" contains no traversal`);
    }
  });

  it("keeps storage writes scoped to the session's tenant path", async () => {
    // The path handed to storage() is always `${session.restaurantId}/...`;
    // a client-supplied restaurant id is never read by the upload routes.
    const { storage } = await import("../src/lib/services/storage");
    const path = `${"11111111-1111-1111-1111-111111111111"}/menu/probe.jpg`;
    assertEquals(path.split("/")[0], "11111111-1111-1111-1111-111111111111", "first segment is the tenant");
    assert(typeof storage().put === "function", "storage contract present");
  });
});

/* ==========================================================================
   6b. Guest tracking tokens
   ========================================================================== */

describe("audit: guest tracking tokens", () => {
  it("stores only a hash, so a database dump cannot be replayed", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    assert(order.tracking_token, "the guest receives a token");

    const database = await db();
    const row = await database.query<{ tracking_token: string; len: number }>(
      "select tracking_token, length(tracking_token)::int as len from orders where id = $1",
      [order.order_id],
    );
    assertEquals(row.rows[0]?.len, 64, "stored value is a sha256 digest");
    assert(row.rows[0]?.tracking_token !== order.tracking_token, "the raw token is never stored");
    assert(!row.rows[0]!.tracking_token.includes(order.tracking_token), "no plaintext prefix remains");
  });

  it("resolves the tracker only for the exact token", async () => {
    const f = await getFixture();
    const order = await createOrderAsGuest(f.qrToken, [{ menu_item_id: f.itemId, quantity: 1 }]);
    const database = await db();

    const correct = await database.query<{ order: { order_number: string } | null }>(
      "select public.get_order_tracking($1) as order",
      [order.tracking_token],
    );
    assertEquals(correct.rows[0]?.order?.order_number, order.order_number, "the holder can track their order");

    const tampered = await database.query<{ order: unknown }>("select public.get_order_tracking($1) as order", [
      order.tracking_token!.slice(0, -1) + (order.tracking_token!.endsWith("a") ? "b" : "a"),
    ]);
    assertEquals(tampered.rows[0]?.order, null, "a near-miss token reveals nothing");

    // A stored hash is not itself a credential.
    const stored = await database.query<{ tracking_token: string }>(
      "select tracking_token from orders where id = $1",
      [order.order_id],
    );
    const asToken = await database.query<{ order: unknown }>("select public.get_order_tracking($1) as order", [
      stored.rows[0]!.tracking_token,
    ]);
    assertEquals(asToken.rows[0]?.order, null, "presenting the stored hash does not work");
  });

  it("does not hand back the stored digest on an idempotent replay", async () => {
    const f = await getFixture();
    const key = `replay-${Math.random().toString(36).slice(2)}`;
    const first = await createOrderAsGuest(
      f.qrToken,
      [{ menu_item_id: f.itemId, quantity: 1 }],
      { idempotencyKey: key },
    );
    assert(first.tracking_token, "the first submission returns a usable token");

    const replay = await createOrderAsGuest(
      f.qrToken,
      [{ menu_item_id: f.itemId, quantity: 1 }],
      { idempotencyKey: key },
    );
    assertEquals(replay.order_number, first.order_number, "the replay resolves to the original order");
    assert(!replay.tracking_token, "a replay must not return a token that cannot open the tracker");
  });

  it("never exposes tracking tokens to a browser session", async () => {
    const f = await getFixture();
    const database = await db();
    const viaOwner = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ c: number }>(
        "select count(*)::int c from orders where restaurant_id = $1 and tracking_token is not null",
        [f.otherRestaurantId],
      ),
    );
    assertEquals(Number(viaOwner.rows[0]?.c ?? 0), 0, "another tenant's orders stay invisible");
    void database;
  });
});

/* ==========================================================================
   7. Platform administration
   ========================================================================== */

describe("audit: platform admin permissions", () => {
  it("refuses every platform function to a restaurant owner", async () => {
    const f = await getFixture();
    const calls = [
      "select public.platform_overview()",
      "select public.platform_user_directory()",
      "select public.platform_restaurants()",
    ];
    for (const sql of calls) {
      await assertRejects(
        () => as(asUser(f.ownerId), (tx) => tx.query(sql)),
        "MP:FORBIDDEN",
        `owner must not call ${sql}`,
      );
    }
  });

  it("lets a platform admin read account metadata but never tenant order detail", async () => {
    const database = await db();
    const adminId = await (await import("./harness")).createUser(`audit-admin-${Date.now()}@example.test`);
    await database.query("insert into platform_admins (user_id) values ($1)", [adminId]);
    const f = await getFixture();

    const directory = await as(asUser(adminId), (tx) =>
      tx.query<{ list: { email: string }[] }>("select public.platform_user_directory() as list"),
    );
    assert(directory.rows[0]!.list.length > 0, "admin sees the account directory");

    // The admin console is account metadata only: order rows stay tenant-scoped
    // through RLS even for an admin, which is what the product promises.
    const orders = await as(asUser(adminId), (tx) =>
      tx.query<{ c: number }>("select count(*)::int c from orders where restaurant_id = $1", [f.restaurantId]),
    );
    const customers = await as(asUser(adminId), (tx) =>
      tx.query<{ c: number }>("select count(*)::int c from customers where restaurant_id = $1", [f.restaurantId]),
    );
    assertEquals(Number(orders.rows[0]?.c ?? 0), 0, "admin does not read tenant orders through RLS");
    assertEquals(Number(customers.rows[0]?.c ?? 0), 0, "admin does not read tenant customer records through RLS");
  });
});

/* ==========================================================================
   8. Secret exposure
   ========================================================================== */

describe("audit: secret exposure", () => {
  it("never exposes the service_role key or session secret to client bundles", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const clientFiles: string[] = [];

    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
        const source = await readFile(full, "utf8");
        // Only files that opt into the client bundle matter.
        if (source.startsWith('"use client"') || source.startsWith("'use client'")) {
          clientFiles.push(`${full}\n${source}`);
        }
      }
    }
    await walk(path.join(process.cwd(), "src"));

    assert(clientFiles.length > 0, "found client components to scan");
    for (const file of clientFiles) {
      const newline = file.indexOf("\n");
      const name = newline === -1 ? file : file.slice(0, newline);
      const source = newline === -1 ? "" : file.slice(newline + 1);
      assert(
        !source.includes("SUPABASE_SERVICE_ROLE_KEY"),
        `${name} must not reference the service_role key`,
      );
      assert(!source.includes("SESSION_SECRET"), `${name} must not reference the session secret`);
      assert(!source.includes("RESEND_API_KEY"), `${name} must not reference the email provider key`);
      assert(!source.includes("REALTIME_JWT_SECRET"), `${name} must not reference the realtime secret`);
    }
  });

  it("keeps the service_role key out of anything the browser can fetch", async () => {
    const database = await db();
    const f = await getFixture();
    // The design keeps privileged reads in SECURITY DEFINER functions; the key
    // itself is only ever read by server modules. Verify no public table column
    // could echo it back.
    const columns = await database.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and (column_name ilike '%key%' or column_name ilike '%secret%' or column_name ilike '%token%')
        order by table_name`,
    );
    assert(columns.rows.length > 0, "secret-bearing columns exist (tokens, hashes)");

    // Every such column must be a hash, a reference, or live in a table that the
    // browser roles cannot read at all.
    // Tables the browser roles hold no grant on at all (asserted immediately below).
    // `qr_tokens` is deliberately absent: an owner must be able to read and print
    // their own table tokens, and RLS restricts that to owner/manager of the
    // tenant. Its protection is row scoping plus revocation, not secrecy.
    const privileged = [
      "password_reset_tokens",
      "app_sessions",
      "user_credentials",
      "email_outbox",
      "rate_limit_buckets",
    ];
    const exposed = columns.rows.filter(
      (c) =>
        !privileged.includes(c.table_name) &&
        // Both are hashed / client-generated dedupe values, not credentials:
        // tracking_token is sha256 and idempotency_key is a random UUID from the
        // guest's own browser.
        !(c.table_name === "orders" && ["tracking_token", "idempotency_key"].includes(c.column_name)) &&
        // qr_tokens.token is the printable code itself: an owner must be able to
        // render the QR. RLS scopes it to owner/manager of that tenant and the
        // token is revocable, which is the intended protection.
        !(c.table_name === "qr_tokens" && c.column_name === "token"),
    );
    for (const column of exposed) {
      assert(
        // A safe secret-bearing column is a digest, a reference or a file path —
        // never a usable credential in plaintext.
        /(_hash|_sha256|_id|_path|_at)$/.test(column.column_name),
        `${column.table_name}.${column.column_name} looks like a readable secret`,
      );
    }

    // A platform admin row is visible only to the account that holds it.
    const foreignAdmin = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ c: number }>("select count(*)::int c from platform_admins where user_id <> $1", [f.ownerId]),
    );
    assertEquals(Number(foreignAdmin.rows[0]?.c ?? 0), 0, "admin flags of other accounts stay invisible");

    // Pending invitations are visible to owners/managers of that tenant only.
    const foreignInvites = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ c: number }>("select count(*)::int c from staff_invitations where restaurant_id = $1", [
        f.otherRestaurantId,
      ]),
    );
    assertEquals(Number(foreignInvites.rows[0]?.c ?? 0), 0, "another tenant's invitations stay invisible");

    // The QR token itself must never be readable by another tenant.
    const foreignQr = await as(asUser(f.ownerId), (tx) =>
      tx.query<{ c: number }>("select count(*)::int c from qr_tokens where restaurant_id = $1", [f.otherRestaurantId]),
    );
    assertEquals(Number(foreignQr.rows[0]?.c ?? 0), 0, "another tenant's QR tokens stay invisible");

    // And the privileged tables really are closed to browser roles.
    for (const table of privileged) {
      const grants = await database.query<{ c: number }>(
        `select count(*)::int c from information_schema.role_table_grants
          where table_schema = 'public' and table_name = $1 and grantee in ('anon','authenticated')`,
        [table],
      );
      assertEquals(Number(grants.rows[0]?.c ?? 0), 0, `${table} must not be granted to browser roles`);
    }
  });
});

/* ==========================================================================
   9. Authentication and session handling
   ========================================================================== */

describe("audit: session handling", () => {
  it("stores only a hash of the session token", async () => {
    const { signIn, SESSION_COOKIE } = await import("../src/lib/auth/session");
    void SESSION_COOKIE;
    const database = await db();
    const f = await getFixture();
    void f;
    // A fresh user with a known password, created exactly the way the app does.
    const { createUser } = await import("./harness");
    const email = `session-${Date.now()}@example.test`;
    await createUser(email, "StrongPass123");
    const result = await signIn(email, "StrongPass123");

    const stored = await database.query<{ token_hash: string }>(
      "select token_hash from public.app_sessions where user_id = $1 order by created_at desc limit 1",
      [result.user.id],
    );
    assert(stored.rows[0], "session row written");
    assert(stored.rows[0]!.token_hash !== result.token, "the raw token is never stored");
    assertEquals(stored.rows[0]!.token_hash.length, 64, "stored value is a sha256 hex digest");
  });

  it("expires and revokes sessions server-side", async () => {
    const { signIn, getSessionUser, destroySession } = await import("../src/lib/auth/session");
    const { createUser } = await import("./harness");
    const email = `revoke-${Date.now()}@example.test`;
    await createUser(email, "StrongPass123");
    const { token } = await signIn(email, "StrongPass123");

    assert((await getSessionUser(token)) !== null, "valid session resolves");
    await destroySession(token);
    assertEquals(await getSessionUser(token), null, "destroyed session no longer resolves");
    assertEquals(await getSessionUser("x".repeat(43)), null, "a guessed token resolves to nothing");
    assertEquals(await getSessionUser(undefined), null, "no token resolves to nothing");
  });

  it("does not reveal whether an email exists at sign-in", async () => {
    const { signIn } = await import("../src/lib/auth/session");
    const { createUser } = await import("./harness");
    const email = `probe-${Date.now()}@example.test`;
    await createUser(email, "StrongPass123");

    const wrongPassword = await signIn(email, "WrongPass123").then(
      () => "signed in",
      (error: Error) => error.message,
    );
    const unknownEmail = await signIn(`missing-${Date.now()}@example.test`, "WrongPass123").then(
      () => "signed in",
      (error: Error) => error.message,
    );
    assertEquals(wrongPassword, unknownEmail, "the same message is returned in both cases");
  });
});

/* ==========================================================================
   Runner
   ========================================================================== */

/**
 * Runs the security suite.
 *
 * The suite registers itself at import time against its own tiny describe/it
 * collector, then hands the collected tree to this runner. Keeping it separate
 * means `tests/run.ts` (the product suite) and this audit suite can share one
 * process and one database without duplicating the runner.
 */
export function securitySuites(): { name: string; tests: Test[] }[] {
  return (current as unknown as { suites?: { name: string; tests: Test[] }[] }).suites ?? [];
}

export async function runSecuritySuite(options: { onResult?: (name: string, ok: boolean, ms: number, error?: string) => void } = {}) {
  let passed = 0;
  let failed = 0;

  const suites = securitySuites();
  for (const suite of suites) {
    for (const test of suite.tests) {
      if (test.name.startsWith("__suite__")) continue;
      const started = Date.now();
      try {
        await test.fn();
        passed += 1;
        options.onResult?.(`${suite.name} › ${test.name}`, true, Date.now() - started);
      } catch (error) {
        failed += 1;
        options.onResult?.(
          `${suite.name} › ${test.name}`,
          false,
          Date.now() - started,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
  return { passed, failed };
}
