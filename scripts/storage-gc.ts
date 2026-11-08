/**
 * Storage garbage collection for the *local* driver.
 *
 * Uploading an image before a dish exists is a legitimate UI flow (the owner picks
 * a photo while filling the form). If they then abandon the form, the object stays
 * behind with nothing pointing at it. Those are the only objects this removes.
 *
 * An object is unreferenced when nothing points at it:
 *   restaurants.logo_path / cover_path
 *   menu_items.image_path
 *   menu_item_images.storage_path
 *
 * Default is a dry run. Pass --delete to actually remove, and --older-than=<hours>
 * to protect very recent uploads that may still be mid-edit (default 24).
 *
 *   npx tsx scripts/storage-gc.ts                  # report only
 *   npx tsx scripts/storage-gc.ts --delete         # remove >24h old orphans
 *   npx tsx scripts/storage-gc.ts --delete --older-than=1
 */
import "dotenv/config";
import { getDb } from "../src/lib/db";
import { storage } from "../src/lib/services/storage";

const args = process.argv.slice(2);
const shouldDelete = args.includes("--delete");
const olderThanArg = args.find((a) => a.startsWith("--older-than="));
const olderThanHours = Number(olderThanArg?.split("=")[1] ?? 24);

if (!Number.isFinite(olderThanHours) || olderThanHours < 0) {
  console.error("--older-than must be a number of hours");
  process.exit(1);
}

const db = await getDb();

const orphans = await db.query<{ bucket: "menu" | "branding"; path: string; byte_size: number; created_at: string }>(
  `select s.bucket, s.path, s.byte_size, s.created_at
     from public.storage_objects s
    where s.created_at < now() - ($1 || ' hours')::interval
      and not exists (select 1 from public.restaurants r where r.logo_path = s.path or r.cover_path = s.path)
      and not exists (select 1 from public.menu_items m where m.image_path = s.path)
      and not exists (select 1 from public.menu_item_images mi where mi.storage_path = s.path)
    order by s.created_at`,
  [String(olderThanHours)],
);

const bytes = orphans.rows.reduce((sum, row) => sum + Number(row.byte_size ?? 0), 0);
console.log(`driver: ${storage().driver}`);
console.log(`unreferenced objects older than ${olderThanHours}h: ${orphans.rows.length} (${(bytes / 1024).toFixed(1)} KiB)`);
for (const row of orphans.rows) {
  console.log(`  ${row.bucket}/${row.path}  ${row.byte_size}B  ${row.created_at}`);
}

if (!shouldDelete) {
  if (orphans.rows.length > 0) console.log("\nDry run. Re-run with --delete to remove them.");
  await db.close();
  process.exit(0);
}

for (const row of orphans.rows) {
  await storage().remove(row.bucket, row.path);
}
console.log(`removed ${orphans.rows.length} object(s)`);
await db.close();
