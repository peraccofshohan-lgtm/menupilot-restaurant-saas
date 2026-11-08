/**
 * Menu image pipeline.
 *
 *   npx tsx scripts/menu-images.ts optimize   # source PNGs → optimised WebP assets
 *   npx tsx scripts/menu-images.ts audit      # uniqueness + assignment + render check
 *
 * Source photographs live in `images/menu/<slug>.png` and are not shipped: they are
 * 2–3 MB each. `optimize` produces the assets the seed actually uploads, at
 *
 *     public/seed-images/menu/<slug>.webp     1200 × 1200, quality 82
 *
 * 1200 px square is chosen against the real card sizes in the customer menu:
 *   · grid card   h-24  (96 px tall, ~150 px wide)   → ~1.6× for a 2× display
 *   · item sheet  h-52  (208 px tall, ~360 px wide)  → ~1.7× for a 2× display
 * `object-cover` crops the square to the card, so every image is composed with the
 * dish centred and nothing important near the edges.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "images", "menu");
const OUTPUT_DIR = path.join(ROOT, "public", "seed-images", "menu");

export const TARGET_SIZE = 1200;
export const WEBP_QUALITY = 82;

export async function sourceSlugs(): Promise<string[]> {
  const files = await readdir(SOURCE_DIR).catch(() => [] as string[]);
  return files
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
}

/** Aspect ratio of the source, so a non-square original is reported rather than silently cropped. */
async function describe(file: string) {
  const meta = await sharp(file).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

async function optimize(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const slugs = await sourceSlugs();
  if (slugs.length === 0) {
    console.log("\n  No source images in images/menu/ yet.\n");
    return;
  }

  console.log(`\n  Optimising ${slugs.length} menu photograph(s) → ${TARGET_SIZE}×${TARGET_SIZE} WebP q${WEBP_QUALITY}\n`);
  let totalBefore = 0;
  let totalAfter = 0;

  for (const slug of slugs) {
    const source = path.join(SOURCE_DIR, `${slug}.png`);
    const target = path.join(OUTPUT_DIR, `${slug}.webp`);
    const before = await readFile(source);
    const { width, height } = await describe(source);

    // `cover`, centred: the dish is always the subject and always centred in these
    // photographs, so a centre crop keeps it. No letterboxing — a menu card should
    // never show empty bars.
    const after = await sharp(before)
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: WEBP_QUALITY, effort: 5 })
      .toBuffer();

    await writeFile(target, after);
    totalBefore += before.byteLength;
    totalAfter += after.byteLength;
    const ratio = (after.byteLength / before.byteLength) * 100;
    const aspect = Math.abs(width / height - 1) < 0.02 ? "" : ` (source ${width}×${height}, centre-cropped)`;
    console.log(
      `  ✓ ${slug}.webp  ${(before.byteLength / 1024).toFixed(0)}→${(after.byteLength / 1024).toFixed(0)} KiB` +
        ` (${ratio.toFixed(0)}%)${aspect}`,
    );
  }

  console.log(
    `\n  ${slugs.length} files · ${(totalBefore / 1024 / 1024).toFixed(1)} MiB → ${(totalAfter / 1024 / 1024).toFixed(2)} MiB` +
      ` · average ${(totalAfter / slugs.length / 1024).toFixed(0)} KiB\n`,
  );
}

/* ==========================================================================
   audit
   ========================================================================== */

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Difference hash (dHash), 64 bits.
 *
 * Byte-identical files are only the easy case: the same photograph re-saved at a
 * different quality, or cropped by 2%, has a completely different SHA-256 and a
 * nearly identical dHash. This is what detects "a different filename does not count
 * as a different photograph".
 */
export async function dhash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: "fill" }) // 9 columns → 8 horizontal comparisons per row
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits += data[y * 9 + x]! < data[y * 9 + x + 1]! ? "1" : "0";
    }
  }
  return bits;
}

export function hamming(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) distance += 1;
  return distance;
}

async function audit(): Promise<void> {
  const { getDb } = await import("../src/lib/db");
  const db = await getDb();

  const items = await db.query<{ id: string; name: string; image_path: string | null }>(
    `select i.id, i.name, i.image_path
       from public.menu_items i
      where i.is_archived = false
      order by i.sort_order`,
  );
  console.log(`\n  ${items.rows.length} menu items\n`);

  // --- assignment: an image per item, no repetition --------------------------
  const byPath = new Map<string, string[]>();
  for (const row of items.rows) {
    const key = row.image_path ?? "(missing)";
    byPath.set(key, [...(byPath.get(key) ?? []), row.name]);
  }
  const reused = [...byPath.entries()].filter(([, names]) => names.length > 1);
  console.log(`  distinct image paths assigned : ${byPath.size}`);
  console.log(`  items without an image        : ${items.rows.filter((r) => !r.image_path).length}`);
  console.log(`  image paths used more than once: ${reused.length}`);
  for (const [p, names] of reused) console.log(`    ✗ ${p} → ${names.length} dishes`);

  // --- byte-level uniqueness of the generated assets -------------------------
  const slugs = await sourceSlugs();
  const hashes = new Map<string, string[]>();
  const fingerprints = new Map<string, string>();

  for (const slug of slugs) {
    const file = path.join(OUTPUT_DIR, `${slug}.webp`);
    const buffer = await readFile(file).catch(() => null);
    if (!buffer) {
      console.log(`    ✗ ${slug}: optimised asset missing (run optimize)`);
      continue;
    }
    const hash = sha256(buffer);
    hashes.set(hash, [...(hashes.get(hash) ?? []), slug]);
    fingerprints.set(slug, await dhash(buffer));
  }

  const duplicateBytes = [...hashes.values()].filter((group) => group.length > 1);
  console.log(`\n  unique image files (sha256)   : ${hashes.size} of ${slugs.length}`);
  for (const group of duplicateBytes) console.log(`    ✗ identical bytes: ${group.join(", ")}`);

  // --- perceptual uniqueness -------------------------------------------------
  // Threshold 6 of 64 bits: below that two files are the same photograph. Real
  // distinct dishes in the same style typically differ by 20+ bits.
  const THRESHOLD = 6;
  const near: [string, string, number][] = [];
  const list = [...fingerprints.entries()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const d = hamming(list[i]![1], list[j]![1]);
      if (d <= THRESHOLD) near.push([list[i]![0], list[j]![0], d]);
    }
  }
  console.log(`  perceptually near-identical  : ${near.length} pair(s) at ≤${THRESHOLD}/64 bits`);
  for (const [a, b, d] of near) console.log(`    ✗ ${a} ~ ${b} (distance ${d})`);

  // Also confirm the assets on disk cover every item, matched by the photo slug in
  // the seed data — so "50 dishes" and "50 photographs" cannot drift apart.
  const { DEMO_MENU } = await import("../src/lib/seed/menu-data");
  const expected = DEMO_MENU.flatMap((c) => c.items.map((i) => ({ name: i.name, photo: i.photo })));
  const onDisk = new Set(slugs);
  const missingForItem = expected.filter((i) => !onDisk.has(i.photo));
  console.log(`\n  seed items naming a photograph : ${expected.length - missingForItem.length}/${expected.length}`);
  for (const i of missingForItem) console.log(`    ✗ ${i.name} → ${i.photo}.webp not generated`);

  const failed =
    reused.length > 0 || duplicateBytes.length > 0 || near.length > 0 || missingForItem.length > 0;
  console.log(`\n  ${failed ? "\x1b[31mFAILED\x1b[0m" : "\x1b[32mPASSED\x1b[0m"}\n`);
  await db.close();
  process.exit(failed ? 1 : 0);
}

/* ========================================================================== */

const mode = process.argv[2] ?? "optimize";
if (mode === "optimize") {
  await optimize();
} else if (mode === "audit") {
  await audit();
} else {
  console.error(`Unknown mode "${mode}". Use: optimize | audit`);
  process.exit(1);
}
