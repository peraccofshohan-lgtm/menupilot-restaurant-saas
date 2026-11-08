import { getDb } from "./src/lib/db";
import { DEMO_MENU } from "./src/lib/seed/menu-data";
import { existsSync } from "node:fs";

const db = await getDb();
// Every non-archived item in the database, with its current assignment.
const rows = await db.query<{ id: string; name: string; cat: string; image_path: string | null }>(
  `select i.id, i.name, c.name as cat, i.image_path
     from public.menu_items i
     join public.categories c on c.id = i.category_id
    where i.is_archived = false
    order by c.sort_order, i.sort_order`,
);

// The seed's per-dish photo mapping is the source of truth for what should exist.
const seedBySlug = new Map<string, { photo: string; cat: string }>();
for (const c of DEMO_MENU) for (const i of c.items) seedBySlug.set(i.name, { photo: i.photo, cat: c.name });

const withAsset: string[] = [];
const missing: { id: string; name: string; cat: string; photo: string }[] = [];

for (const r of rows.rows) {
  const seed = seedBySlug.get(r.name);
  if (!seed) { console.log("!! item not in seed data:", r.name); continue; }
  const asset = `public/seed-images/menu/${seed.photo}.webp`;
  if (existsSync(asset)) withAsset.push(r.name);
  else missing.push({ id: r.id, name: r.name, cat: seed.cat, photo: seed.photo });
}

console.log(`DB items: ${rows.rows.length} | seed items: ${seedBySlug.size}`);
console.log(`assets exist for: ${withAsset.length}`);
console.log(`still missing   : ${missing.length}\n`);
console.log("REMAINING ITEMS (name | id | category | photo slug):");
for (const m of missing) console.log(`${m.name} | ${m.id} | ${m.cat} | ${m.photo}`);

const byCat = new Map<string, number>();
for (const m of missing) byCat.set(m.cat, (byCat.get(m.cat) ?? 0) + 1);
console.log("\nBy category:", JSON.stringify(Object.fromEntries(byCat)));
await db.close(); process.exit(0);
