/**
 * Generates the PWA icon set from the restaurant logo.
 *
 * Kept in the repository so the icons can be regenerated for a different
 * restaurant without a design tool, and so it is obvious where they came from.
 * Everything runs locally with sharp — no icon CDN, no upload.
 *
 *   npx tsx scripts/make-icons.mts
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const SOURCE = path.join(process.cwd(), "public", "seed-images", "logo-mati.png");
const OUT = path.join(process.cwd(), "public", "icons");
const BRAND = { r: 24, g: 24, b: 20, alpha: 1 } as const;

await mkdir(OUT, { recursive: true });

for (const size of [192, 512]) {
  await sharp(SOURCE)
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `icon-${size}.png`));
}

// Maskable icons are cropped to a circle by Android, so the mark is inset into
// the safe area (80% of the canvas) instead of filling the square.
const inner = Math.round(512 * 0.8);
const pad = Math.round((512 - inner) / 2);
await sharp(SOURCE)
  .resize(inner, inner, { fit: "contain", background: BRAND })
  .extend({ top: pad, bottom: pad, left: pad, right: pad, background: BRAND })
  .png({ compressionLevel: 9 })
  .toFile(path.join(OUT, "icon-maskable-512.png"));

await sharp(SOURCE).resize(180, 180, { fit: "cover" }).png().toFile(path.join(OUT, "apple-touch-icon.png"));
await sharp(SOURCE).resize(32, 32, { fit: "cover" }).png().toFile(path.join(OUT, "favicon-32.png"));

const meta = await sharp(SOURCE).metadata();
console.log(`icons written to public/icons from ${meta.width}x${meta.height} source`);
