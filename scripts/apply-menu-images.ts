/**
 * Assigns the per-dish photographs to the existing MATI Kitchen menu items.
 *
 * This is an *image-only* migration. It reads the 50 optimised WebP assets,
 * uploads each one under `<restaurantId>/menu/<dish-slug>.webp`, and updates
 * `menu_items.image_path` for the matching row. Nothing else is touched.
 *
 * To make that claim checkable rather than merely asserted, the script hashes
 * every protected table before and after the update and fails if anything other
 * than `menu_items.image_path` changed. It never reseeds, never inserts and
 * never deletes a menu item.
 *
 *   npx tsx scripts/apply-menu-images.ts [--dry-run]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import { DEMO_MENU } from "../src/lib/seed/menu-data";
import { storage } from "../src/lib/services/storage";

const ASSET_DIR = path.join(process.cwd(), "public/seed-images/menu");
const DRY_RUN = process.argv.includes("--dry-run");

/** Tables whose contents must not change. `menu_items.image_path` is excluded. */
const PROTECTED = [
  { table: "public.restaurants", order: "id" },
  { table: "public.categories", order: "id" },
  { table: "public.dining_tables", order: "id" },
  { table: "public.qr_tokens", order: "id" },
  { table: "public.orders", order: "id" },
  { table: "public.order_items", order: "id" },
  { table: "public.order_status_history", order: "id" },
  { table: "public.customers", order: "id" },
  { table: "public.restaurant_settings", order: "restaurant_id" },
  { table: "public.restaurant_members", order: "restaurant_id, user_id" },
] as const;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Everything about a menu item except the two columns this script is allowed to
 * touch: `image_path`, and `updated_at`, which the `touch_updated_at` trigger
 * rewrites on any update. Excluding the timestamp is the difference between
 * "only the image changed" and a check that can never pass.
 */
async function menuItemsHash(db: Db) {
  const rows = await db.query(
    `select id, restaurant_id, category_id, name, slug, description, price,
            is_available, is_featured, sort_order, prep_minutes, created_at
       from public.menu_items
      order by id`,
  );
  return { rows: rows.rows.length, hash: digest(rows.rows) };
}

async function protectedState(db: Db) {
  const out: Record<string, { rows: number; hash: string }> = {};
  for (const p of PROTECTED) {
    const res = await db.query(`select * from ${p.table} order by ${p.order}`);
    out[p.table] = { rows: res.rows.length, hash: digest(res.rows) };
  }
  out["public.menu_items (excl. image_path)"] = await menuItemsHash(db);
  return out;
}

const db = await getDb();

const restaurant = (
  await db.query<{ id: string; name: string }>("select id, name from public.restaurants order by created_at limit 1")
).rows[0];
if (!restaurant) throw new Error("no restaurant found — refusing to run");

console.log(`restaurant : ${restaurant.name} (${restaurant.id})`);
console.log(`mode       : ${DRY_RUN ? "DRY RUN" : "apply"}\n`);

const before = await protectedState(db);
const items = (
  await db.query<{ id: string; name: string; image_path: string | null }>(
    `select id, name, image_path from public.menu_items order by name`,
  )
).rows;

// The seed's `photo` slug is the single source of truth for which photograph
// belongs to which dish.
const photoFor = new Map<string, string>();
for (const c of DEMO_MENU) for (const i of c.items) photoFor.set(i.name, i.photo);

const missingAssets: string[] = [];
const unmatched: string[] = [];
const planned: { id: string; name: string; from: string | null; to: string; data: Buffer }[] = [];

for (const item of items) {
  const slug = photoFor.get(item.name);
  if (!slug) {
    unmatched.push(item.name);
    continue;
  }
  const file = path.join(ASSET_DIR, `${slug}.webp`);
  if (!existsSync(file)) {
    missingAssets.push(item.name);
    continue;
  }
  planned.push({
    id: item.id,
    name: item.name,
    from: item.image_path,
    to: `${restaurant.id}/menu/${slug}.webp`,
    data: readFileSync(file),
  });
}

if (unmatched.length) {
  console.error(`\n✗ ${unmatched.length} database item(s) have no photo slug in the seed data:`);
  for (const n of unmatched) console.error(`    ${n}`);
  await db.close();
  process.exit(1);
}
if (missingAssets.length) {
  console.error(`\n✗ ${missingAssets.length} item(s) are missing their asset:`);
  for (const n of missingAssets) console.error(`    ${n}`);
  await db.close();
  process.exit(1);
}
if (planned.length !== items.length) {
  console.error(`\n✗ planned ${planned.length} of ${items.length} items — aborting`);
  await db.close();
  process.exit(1);
}

if (!DRY_RUN) {
  for (const p of planned) {
    await storage().put({
      bucket: "menu",
      path: p.to,
      data: p.data,
      contentType: "image/webp",
      restaurantId: restaurant.id,
    });
    await db.query("update public.menu_items set image_path = $2 where id = $1", [p.id, p.to]);
  }
}

const after = await protectedState(db);

// ---- report ----------------------------------------------------------------
let failed = false;
console.log("PROTECTED DATA — before vs after");
console.log("─".repeat(74));
console.log("table".padEnd(46) + "rows".padEnd(9) + "hash".padEnd(11) + "status");
for (const key of Object.keys(before)) {
  const b = before[key]!;
  const a = after[key]!;
  const same = b.hash === a.hash && b.rows === a.rows;
  if (!same) failed = true;
  console.log(
    key.padEnd(46) +
      `${b.rows}→${a.rows}`.padEnd(9) +
      b.hash.padEnd(11) +
      (same ? "unchanged" : "CHANGED ✗"),
  );
}

const changed = planned.filter((p) => p.from !== p.to);
console.log("\nIMAGE PATHS");
console.log("─".repeat(74));
console.log(`items assigned a photograph : ${planned.length}/${items.length}`);
console.log(`paths actually changed      : ${changed.length}`);
console.log(`distinct target paths       : ${new Set(planned.map((p) => p.to)).size}`);

if (!DRY_RUN) {
  const verify = await db.query<{ n: number }>(
    `select count(*)::int n from public.menu_items where image_path is not null`,
  );
  console.log(`items with a non-null path  : ${verify.rows[0]!.n}`);
}

await db.close();
if (failed) {
  console.error("\n✗ FAILED — a protected table changed");
  process.exit(1);
}
console.log(`\n${DRY_RUN ? "✓ dry run clean" : "✓ image-only update complete, all protected data unchanged"}`);
process.exit(0);
