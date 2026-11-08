/**
 * Prints the live demo tenant inventory: restaurant id, category/item/table
 * counts and the QR token for every table.
 *
 * Tokens are credentials — they let anyone holding one order to a table. This
 * writes the full inventory only to `.data/` (git-ignored) and prints just
 * counts and identifiers to stdout so the output is safe to paste anywhere.
 */
import { getDb } from "../src/lib/db";
import { writeFileSync, mkdirSync } from "node:fs";

const db = await getDb();
const r = (await db.query<{ id: string; name: string; slug: string }>(
  "select id, name, slug from public.restaurants order by created_at limit 1")).rows[0]!;

const counts = (await db.query<Record<string, number>>(`
  select (select count(*) from public.categories where restaurant_id=$1)::int as categories,
         (select count(*) from public.menu_items where restaurant_id=$1)::int as items,
         (select count(*) from public.menu_items where restaurant_id=$1 and image_path is not null)::int as items_with_image,
         (select count(distinct image_path) from public.menu_items where restaurant_id=$1)::int as distinct_images,
         (select count(*) from public.dining_tables where restaurant_id=$1)::int as tables,
         (select count(*) from public.qr_tokens where restaurant_id=$1)::int as tokens,
         (select count(*) from public.orders where restaurant_id=$1)::int as orders
`, [r.id])).rows[0]!;

const tables = (await db.query<{ label: string; token: string }>(
  `select t.label, q.token from public.dining_tables t
     join public.qr_tokens q on q.table_id = t.id
    where t.restaurant_id = $1 order by t.sort_order`, [r.id])).rows;

mkdirSync(".data", { recursive: true });
writeFileSync(".data/demo-inventory.json", JSON.stringify({ restaurant: r, counts, tables }, null, 2));
writeFileSync(".data/demo-qr-tokens.txt",
  `MATI Kitchen — QR token inventory (fresh, cryptographically random)\n` +
  `restaurant id: ${r.id}\n\n` +
  tables.map((t) => `${t.label.padEnd(10)} ${t.token}`).join("\n") + "\n");

console.log("restaurant id :", r.id);
console.log("restaurant    :", r.name, `/menu/${r.slug}`);
console.log("counts        :", JSON.stringify(counts));
console.log("qr tokens     :", tables.length, "for", counts.tables, "tables");
console.log("min token len :", Math.min(...tables.map(t => t.token.length)), "hex chars");
console.log("unique tokens :", new Set(tables.map(t => t.token)).size);
console.log("\nfull inventory written to .data/demo-inventory.json and .data/demo-qr-tokens.txt (git-ignored)");
await db.close(); process.exit(0);
