import "dotenv/config";
import { randomBytes } from "node:crypto";
import { getDb } from "../src/lib/db";

/**
 * Rebuilds the order history a demo tenant should have on show day.
 *
 * This is the deliberate pair to `reset_demo_orders()`: reset empties the
 * order tables so a walkthrough can start clean, and this fills them back up
 * with four weeks of plausible trade so the dashboard has something to
 * demonstrate. Neither script can touch the menu, the tables or the QR tokens,
 * and this one refuses outright unless the tenant is flagged `is_demo`.
 */

const DAYS = 28;
const TODAY_ORDERS = 6;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REJECT_REASON = "Table requested a change and placed a new order.";

const NOTES = [null, null, null, "Less oil, please.", "One portion extra spicy.", "No chilli on the kids' plate.", "Please serve the drinks first.", "Allergy note: no peanuts."];
const ITEM_NOTES = [null, null, null, "Extra gravy on the side", "No onion", "Well done"];

const GUESTS = [
  { name: "Nusrat Jahan", phone: "+8801711000011" },
  { name: "Arif Hossain", phone: "+8801711000022" },
  { name: "Sadia Islam", phone: "+8801711000033" },
  { name: "Tanvir Ahmed", phone: "+8801711000044" },
  { name: "Farhana Rahman", phone: "+8801711000055" },
  { name: "Rifat Chowdhury", phone: "+8801711000066" },
  { name: "Mehedi Hasan", phone: "+8801711000077" },
  { name: "Ayesha Karim", phone: "+8801711000088" },
];

async function main() {
  const db = await getDb();
  const force = process.argv.includes("--force");

  const tenant = await db.query<{ id: string; name: string; slug: string; is_demo: boolean; currency: string }>(
    "select id, name, slug, is_demo, currency from public.restaurants where is_demo = true order by created_at limit 1",
  );
  if (tenant.rows.length === 0) {
    console.error("\n  No demo tenant found. Run `npm run db:seed` first.\n");
    process.exit(1);
  }
  const r = tenant.rows[0]!;
  if (!r.is_demo) {
    console.error(`\n  ${r.name} is not a demo tenant. Refusing to write order history to a live restaurant.\n`);
    process.exit(1);
  }

  const existing = await db.query<{ n: number }>(
    "select count(*)::int n from public.orders where restaurant_id = $1",
    [r.id],
  );
  if (existing.rows[0]!.n > 0 && !force) {
    console.log(`\n  ${r.name} already has ${existing.rows[0]!.n} orders — nothing written.`);
    console.log("  Use `npm run demo:history -- --force` to add another four weeks on top.\n");
    process.exit(0);
  }

  const items = await db.query<{ id: string; name: string; price: number }>(
    "select id, name, price from public.menu_items where restaurant_id = $1 and is_available = true order by sort_order, name",
    [r.id],
  );
  const tables = await db.query<{ id: string; label: string }>(
    "select id, label from public.dining_tables where restaurant_id = $1 order by sort_order, label",
    [r.id],
  );
  if (items.rows.length === 0 || tables.rows.length === 0) {
    console.error("\n  The demo tenant has no menu items or tables — seed it before generating history.\n");
    process.exit(1);
  }

  const rand = mulberry32(20261108);
  const pick = <T,>(values: T[]) => values[Math.floor(rand() * values.length)]!;

  // Guest records. Reused when they already exist so repeat runs do not pile up
  // duplicate phone numbers.
  const guestIds: string[] = [];
  for (const g of GUESTS) {
    const found = await db.query<{ id: string }>(
      "select id from public.customers where restaurant_id = $1 and phone = $2 limit 1",
      [r.id, g.phone],
    );
    if (found.rows[0]) {
      guestIds.push(found.rows[0].id);
      continue;
    }
    const inserted = await db.query<{ id: string }>(
      `insert into public.customers (restaurant_id, name, phone, first_order_at, last_order_at)
       values ($1, $2, $3, now(), now()) returning id`,
      [r.id, g.name, g.phone],
    );
    guestIds.push(inserted.rows[0]!.id);
  }

  let written = 0;
  const cents = (n: number) => Math.round(n * 100) / 100;

  for (let dayOffset = DAYS; dayOffset >= 0; dayOffset -= 1) {
    const isToday = dayOffset === 0;
    const weekday = new Date(Date.now() - dayOffset * 86_400_000).getDay();
    const weekendBoost = weekday === 5 || weekday === 6 ? 5 : 0;
    const perDay = isToday ? TODAY_ORDERS : Math.floor(rand() * 7) + 6 + weekendBoost;

    for (let o = 0; o < perDay; o += 1) {
      const minutesAgo = isToday ? Math.floor(rand() * 300) + 10 : dayOffset * 1440 - Math.floor(rand() * 480) - 120;
      const createdAt = new Date(Date.now() - minutesAgo * 60_000);

      const lines: { id: string; name: string; price: number; qty: number; note: string | null }[] = [];
      const used = new Set<string>();
      const lineCount = Math.floor(rand() * 3) + 1;
      for (let l = 0; l < lineCount; l += 1) {
        const candidate = pick(items.rows);
        if (used.has(candidate.id)) continue;
        used.add(candidate.id);
        lines.push({
          id: candidate.id,
          name: candidate.name,
          price: candidate.price,
          qty: Math.floor(rand() * 3) + 1,
          note: pick(ITEM_NOTES),
        });
      }
      if (lines.length === 0) continue;

      const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
      const service = cents(subtotal * 0.05);
      const tax = cents(subtotal * 0.05);
      const total = cents(subtotal + service + tax);
      const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);

      let status: string;
      const roll = rand();
      if (isToday) {
        status = roll < 0.2 ? "pending" : roll < 0.4 ? "accepted" : roll < 0.6 ? "preparing" : roll < 0.75 ? "ready" : "served";
      } else if (roll < 0.035) {
        status = "rejected";
      } else if (roll < 0.06) {
        status = "cancelled";
      } else if (roll < 0.1 && dayOffset <= 1) {
        status = "ready";
      } else {
        status = "served";
      }

      const withGuest = rand() < 0.55;
      const guestIndex = Math.floor(rand() * GUESTS.length);
      const customerId = withGuest ? guestIds[guestIndex]! : null;
      const customerName = withGuest ? GUESTS[guestIndex]!.name : rand() < 0.4 ? "Walk-in guest" : null;
      const customerPhone = withGuest ? GUESTS[guestIndex]!.phone : null;

      const orderNumber = `MATI-${createdAt.toISOString().slice(2, 10).replace(/-/g, "")}-${String(1000 + written)}`;
      const tracking = randomBytes(24).toString("hex");
      const table = pick(tables.rows);

      const at = (minutes: number) => new Date(createdAt.getTime() + minutes * 60_000);
      const acceptedAt = ["accepted", "preparing", "ready", "served"].includes(status) ? at(1.5) : null;
      const preparingAt = ["preparing", "ready", "served"].includes(status) ? at(4) : null;
      const readyAt = ["ready", "served"].includes(status) ? at(15) : null;
      const servedAt = status === "served" ? at(25) : null;
      const rejectedAt = status === "rejected" ? at(2) : null;
      const cancelledAt = status === "cancelled" ? at(5) : null;

      const order = await db.query<{ id: string }>(
        `insert into public.orders
           (restaurant_id, table_id, customer_id, order_number, status, subtotal, tax_amount,
            service_charge, total, currency, item_count, customer_name, customer_phone, note,
            source, tracking_token, accepted_at, preparing_at, ready_at,
            served_at, rejected_at, cancelled_at, rejection_reason, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'qr',$15,
                 $16,$17,$18,$19,$20,$21,$22,$23,$23)
         returning id`,
        [
          r.id, table.id, customerId, orderNumber, status, subtotal, tax, service, total,
          r.currency || "BDT", itemCount, customerName, customerPhone, pick(NOTES), tracking,
          acceptedAt, preparingAt, readyAt, servedAt, rejectedAt, cancelledAt,
          status === "rejected" ? REJECT_REASON : null, createdAt,
        ],
      );
      const orderId = order.rows[0]!.id;

      for (const [index, line] of lines.entries()) {
        await db.query(
          `insert into public.order_items
             (order_id, restaurant_id, menu_item_id, name_snapshot, unit_price, quantity,
              line_total, note, sort_order, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [orderId, r.id, line.id, line.name, line.price, line.qty, line.price * line.qty, line.note, index, createdAt],
        );
      }

      const history: { from: string | null; to: string; at: Date }[] = [{ from: null, to: "pending", at: createdAt }];
      if (acceptedAt) history.push({ from: "pending", to: "accepted", at: acceptedAt });
      if (preparingAt) history.push({ from: "accepted", to: "preparing", at: preparingAt });
      if (readyAt) history.push({ from: "preparing", to: "ready", at: readyAt });
      if (servedAt) history.push({ from: "ready", to: "served", at: servedAt });
      if (rejectedAt) history.push({ from: "pending", to: "rejected", at: rejectedAt });
      if (cancelledAt) history.push({ from: "pending", to: "cancelled", at: cancelledAt });
      for (const h of history) {
        await db.query(
          `insert into public.order_status_history
             (order_id, restaurant_id, from_status, to_status, actor_role, created_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [orderId, r.id, h.from, h.to, h.from === null ? "customer" : "owner", h.at],
        );
      }

      if (customerId && ["ready", "served"].includes(status)) {
        await db.query(
          `update public.customers set
             total_orders = total_orders + 1,
             total_spend = total_spend + $2,
             last_order_at = greatest(coalesce(last_order_at, $3), $3),
             first_order_at = least(coalesce(first_order_at, $3), $3)
           where id = $1`,
          [customerId, total, createdAt],
        );
      }

      written += 1;
    }
  }

  const after = await db.query<{ orders: number; items: number; tables: number; tokens: number }>(
    `select
       (select count(*) from public.orders where restaurant_id = $1)::int orders,
       (select count(*) from public.menu_items where restaurant_id = $1)::int items,
       (select count(*) from public.dining_tables where restaurant_id = $1)::int tables,
       (select count(*) from public.qr_tokens where restaurant_id = $1)::int tokens`,
    [r.id],
  );
  const a = after.rows[0]!;
  console.log(`\n  ${r.name} — order history rebuilt`);
  console.log(`    written    : ${written} orders`);
  console.log(`    total now  : ${a.orders} orders`);
  console.log(`    untouched  : ${a.items} dishes · ${a.tables} tables · ${a.tokens} QR codes`);
  console.log(`    menu       : /menu/${r.slug}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
