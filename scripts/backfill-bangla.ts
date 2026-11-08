/**
 * Fills the Bengali columns on an existing database.
 *
 * This is the non-destructive alternative to re-seeding: it UPDATEs names and
 * descriptions in place, so tenant ids, QR tokens, orders, reviews and every
 * foreign key stay exactly as they are. Safe to run repeatedly — a row already
 * carrying Bangla text is written again with the same value.
 *
 *   npx tsx scripts/backfill-bangla.ts            # report only
 *   npx tsx scripts/backfill-bangla.ts --apply    # write
 *
 * Run with the dev server STOPPED: PGlite is single-writer.
 */
import "dotenv/config";
import { getDb } from "../src/lib/db";
import { BANGLA_CATEGORIES, BANGLA_MENU, BANGLA_RESTAURANT, missingBangla, missingBanglaCategories } from "../src/lib/seed/menu-bangla";
import { DEMO_MENU } from "../src/lib/seed/menu-data";

const apply = process.argv.includes("--apply");

const db = await getDb();

// ---------------------------------------------------------------- report first
const dishes = DEMO_MENU.flatMap((category) => category.items.map((item) => item.name));
const categories = DEMO_MENU.map((category) => category.name);
const gaps = missingBangla(dishes);
const categoryGaps = missingBanglaCategories(categories);

console.log(`\nBengali content coverage`);
console.log(`  dishes      : ${dishes.length - gaps.length}/${dishes.length}`);
console.log(`  categories  : ${categories.length - categoryGaps.length}/${categories.length}`);
if (gaps.length) console.log(`  missing     : ${gaps.join(", ")}`);
if (categoryGaps.length) console.log(`  missing cats: ${categoryGaps.join(", ")}`);

// ------------------------------------------------------- what is in the database
const before = await db.query<{ items_without_bn: number; items: number; cats_without_bn: number; cats: number }>(`
  select (select count(*) from public.menu_items where not is_archived)::int as items,
         (select count(*) from public.menu_items where not is_archived and name_bn is null)::int as items_without_bn,
         (select count(*) from public.categories)::int as cats,
         (select count(*) from public.categories where name_bn is null)::int as cats_without_bn
`);
console.log(`\nbefore: ${JSON.stringify(before.rows[0])}`);

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to write the Bengali fields.\n`);
  process.exit(0);
}

// --------------------------------------------------------------------- restaurant
type Tenant = { id: string; name: string };
const restaurant = await db.transaction<Tenant>(async (tx) => {
  const rest = await tx.query<Tenant>(
    `select id, name from public.restaurants where is_demo order by created_at limit 1`,
  );
  const found = rest.rows[0];
  if (!found) throw new Error("No demo restaurant found — nothing to backfill.");
  await tx.query(
    `update public.restaurants
        set tagline_bn = coalesce(tagline_bn, $2),
            description_bn = coalesce(description_bn, $3),
            address_bn = coalesce(address_bn, $4)
      where id = $1`,
    [found.id, BANGLA_RESTAURANT.tagline, BANGLA_RESTAURANT.description, BANGLA_RESTAURANT.address],
  );

  // ------------------------------------------------------------------ categories
  for (const [englishName, content] of Object.entries(BANGLA_CATEGORIES)) {
    await tx.query(
      `update public.categories set name_bn = $3, description_bn = $4
        where restaurant_id = $1 and name = $2`,
      [found.id, englishName, content.name, content.description],
    );
  }

  // ------------------------------------------------------------------ menu items
  for (const [englishName, content] of Object.entries(BANGLA_MENU)) {
    await tx.query(
      `update public.menu_items set name_bn = $3, description_bn = $4
        where restaurant_id = $1 and name = $2`,
      [found.id, englishName, content.name, content.description],
    );
  }
  return found;
});

const after = await db.query<{ items_without_bn: number; items: number; cats_without_bn: number; cats: number }>(`
  select (select count(*) from public.menu_items where not is_archived)::int as items,
         (select count(*) from public.menu_items where not is_archived and name_bn is null)::int as items_without_bn,
         (select count(*) from public.categories)::int as cats,
         (select count(*) from public.categories where name_bn is null)::int as cats_without_bn
`);

// Nothing protected may move.
const preserved = await db.query<Record<string, number>>(`
  select (select count(*) from public.orders)::int as orders,
         (select count(*) from public.order_reviews)::int as reviews,
         (select count(*) from public.qr_tokens)::int as tokens,
         (select count(*) from public.dining_tables)::int as tables,
         (select count(*) from public.menu_item_images)::int as images
`);
console.log(`after : ${JSON.stringify(after.rows[0])}`);
console.log(`preserved: ${JSON.stringify(preserved.rows[0])}`);
console.log(`\nrestaurant: ${restaurant.name} (${restaurant.id})\n`);
process.exit(0);
