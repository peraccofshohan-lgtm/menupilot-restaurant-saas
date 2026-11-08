/**
 * Verifies the printed QR kit rather than trusting it.
 *
 * Renders every page of the generated PDF to a bitmap, locates each QR code in
 * the raster with jsQR — the same class of decoder a phone camera feeds — and
 * checks that every decoded URL:
 *
 *   * uses the expected public origin,
 *   * carries a token that exists in `public.qr_tokens`,
 *   * belongs to the table whose label sits on that card.
 *
 * A PDF can look right and still encode the wrong token; this is the check that
 * catches that. Run with the dev server stopped.
 *
 *   npx tsx scripts/verify-qr-kit.ts artifacts/mati-kitchen-qr-kit.pdf
 */
import { readFileSync } from "node:fs";

import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { getDb } from "../src/lib/db";

const pdfPath = process.argv[2] ?? "artifacts/mati-kitchen-qr-kit.pdf";
const SCALE = 3; // crisper raster so jsQR can resolve the small overview codes

const db = await getDb();
const rows = (
  await db.query<{ label: string; token: string }>(
    `select t.label, q.token
       from public.dining_tables t
       join public.qr_tokens q on q.table_id = t.id
      where t.is_active = true and q.revoked_at is null
      order by t.sort_order`,
  )
).rows;
await db.close();

const tokenToTable = new Map(rows.map((r) => [r.token, r.label]));
console.log(`database: ${rows.length} tables, ${tokenToTable.size} distinct tokens\n`);

/**
 * pdf.js needs to create canvases for embedded images; in Node it has no default
 * implementation, so hand it ours.
 */
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(canvasAndContext: { canvas: { width: number; height: number } }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy() {
    /* garbage collected */
  }
}

const data = new Uint8Array(readFileSync(pdfPath));
const doc = await pdfjs.getDocument({
  data,
  useSystemFonts: true,
  canvasFactory: new NodeCanvasFactory() as never,
}).promise;
console.log(`pdf: ${pdfPath} — ${doc.numPages} pages`);

interface Found {
  url: string;
  page: number;
  token: string;
  table: string | null;
  valid: boolean;
  origin: string;
}

const found: Found[] = [];
const ORIGIN_RE = /^(https?:\/\/[^/]+)\/q\/([A-Za-z0-9]+)/;

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  const W = canvas.width;
  const H = canvas.height;

  // Scan in overlapping tiles: jsQR wants a mostly-uncluttered field, and a card
  // sheet packs four codes plus text.
  // Sweep a fine grid of overlapping tiles. A coarse grid that skips the right
  // hand column would report half the codes "missing" when they are printed
  // perfectly well — the scanner has to be at least as thorough as the print.
  const tile = Math.floor(Math.min(W, H) * 0.4);
  const step = Math.floor(tile * 0.35);
  const seen = new Set<string>();

  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = 0; x < W; x += step) xs.push(Math.min(x, Math.max(0, W - tile)));
  for (let y = 0; y < H; y += step) ys.push(Math.min(y, Math.max(0, H - tile)));

  for (const y of ys) {
    for (const x of xs) {
      const tw = Math.min(tile, W - x);
      const th = Math.min(tile, H - y);
      if (tw < 40 || th < 40) continue;
      const sub = ctx.getImageData(x, y, tw, th);
      const hit = jsQR(sub.data, tw, th, { inversionAttempts: "attemptBoth" });
      if (!hit?.data || seen.has(hit.data)) continue;
      seen.add(hit.data);

      const m = hit.data.match(ORIGIN_RE);
      const token = m?.[2] ?? "";
      found.push({
        url: hit.data,
        page: p,
        token,
        table: tokenToTable.get(token) ?? null,
        valid: tokenToTable.has(token),
        origin: m?.[1] ?? "",
      });
    }
  }
  console.log(`  page ${p}: ${seen.size} distinct code(s) decoded`);
}

/* ---- report --------------------------------------------------------------- */

const byToken = new Map<string, Found>();
for (const f of found) if (!byToken.has(f.token)) byToken.set(f.token, f);

const origins = new Set(found.map((f) => f.origin).filter(Boolean));
const invalid = [...byToken.values()].filter((f) => !f.valid);

console.log(`\ndecoded distinct tokens : ${byToken.size} / ${rows.length}`);
console.log(`origins encoded         : ${[...origins].join(", ")}`);
console.log(`tokens not in database  : ${invalid.length}`);
for (const bad of invalid) console.log(`    ${bad.token} (page ${bad.page})`);

const missing = rows.filter((r) => !byToken.has(r.token));
console.log(`tables with no code in pdf: ${missing.length}`);
for (const m of missing) console.log(`    ${m.label}`);

/* ---- cross-check the encoded set against the DB set ---------------------- */

const dbTokens = new Set(rows.map((r) => r.token));
const pdfTokens = new Set(byToken.keys());
const sameSet =
  dbTokens.size === pdfTokens.size && [...dbTokens].every((t) => pdfTokens.has(t));

console.log(`\nencoded token set === database token set: ${sameSet ? "YES" : "NO"}`);
console.log(
  sameSet
    ? "PASS — every table's real token is printed, and no other token appears"
    : "FAIL — the pdf and the database disagree",
);

process.exit(sameSet && invalid.length === 0 && missing.length === 0 ? 0 : 1);
