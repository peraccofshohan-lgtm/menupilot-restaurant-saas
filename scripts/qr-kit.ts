/**
 * Builds the printable MATI Kitchen QR kit.
 *
 * Every QR code encodes `<public origin>/q/<token>` using the token stored in
 * `public.qr_tokens` for that table. Nothing is guessed, generated or reused: the
 * script reads the twenty tokens from the database, refuses to run unless there
 * are exactly twenty distinct ones, and re-reads the table label from the same
 * row so a card can never carry the wrong table number.
 *
 * Run with the dev server STOPPED. PGlite is single-writer; opening the data
 * directory while the app holds it has already cost this project one database.
 *
 *   node scripts/qr-kit.ts [--origin https://host] [--out path/to.pdf]
 *
 * Without `--origin` it uses APP_URL, and refuses to fall back to localhost
 * quietly — a QR code pointing at localhost is useless on a diner's phone, so it
 * says so loudly and stamps a warning on the PDF itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

import { getDb } from "../src/lib/db";

/* Page geometry: A4 portrait at 72pt/inch. */
const A4 = { w: 595.28, h: 841.89 };

/* Brand palette, matching the app's tokens. */
const INK = rgb(0.09, 0.094, 0.078);
const INK_SOFT = rgb(0.42, 0.42, 0.39);
const CLAY = rgb(0.72, 0.4, 0.25);
const LINE = rgb(0.85, 0.84, 0.81);
const WHITE = rgb(1, 1, 1);

interface TableRow {
  label: string;
  zone: string | null;
  seats: number | null;
  token: string;
}

async function qrPng(url: string, width: number): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: "png",
    // "M" is the sweet spot for phone cameras: enough damage tolerance (15%)
    // without inflating module count and making the code harder to lock onto.
    errorCorrectionLevel: "M",
    margin: 1,
    width,
    color: { dark: "#181814", light: "#ffffff" },
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const db = await getDb();

const restaurant = (
  await db.query<{ id: string; name: string; slug: string; tagline: string | null; city: string | null }>(
    "select id, name, slug, tagline, city from public.restaurants order by created_at limit 1",
  )
).rows[0];
if (!restaurant) {
  console.error("no restaurant found — nothing to print");
  await db.close();
  process.exit(1);
}

const tables = (
  await db.query<TableRow>(
    `select t.label, t.zone, t.seats, q.token
       from public.dining_tables t
       join public.qr_tokens q on q.table_id = t.id
      where t.restaurant_id = $1
        and t.is_active = true
        and q.revoked_at is null
      order by t.sort_order, t.label`,
    [restaurant.id],
  )
).rows;

await db.close();

/* ---- guard rails ---------------------------------------------------------- */

if (tables.length !== 20) {
  console.error(`expected 20 tables with live QR tokens, found ${tables.length} — refusing to build`);
  process.exit(1);
}
const uniqueTokens = new Set(tables.map((t) => t.token));
if (uniqueTokens.size !== 20) {
  console.error(`tokens are not unique: ${uniqueTokens.size} distinct across 20 tables — refusing to build`);
  process.exit(1);
}
if (tables.some((t) => !t.token || t.token.length < 32)) {
  console.error("a table has a missing or short token — refusing to build");
  process.exit(1);
}
const uniqueLabels = new Set(tables.map((t) => t.label));
if (uniqueLabels.size !== 20) {
  console.error(`table labels are not unique: ${uniqueLabels.size} distinct — refusing to build`);
  process.exit(1);
}

/* ---- origin --------------------------------------------------------------- */

let origin = (arg("--origin") ?? process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const originIsLocal = !origin || /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(origin);
if (originIsLocal && !arg("--origin")) {
  console.warn(
    "\n  WARNING: APP_URL is localhost, so these QR codes will only work on this machine.\n" +
      "  Pass --origin https://<public-host> to encode a reachable URL.\n",
  );
}

const outArg = arg("--out");
const outPath = path.resolve(
  outArg ?? `artifacts/${restaurant.slug}-qr-kit${originIsLocal ? "-LOCAL-ONLY" : ""}.pdf`,
);

/* ---- document ------------------------------------------------------------- */

const pdf = await PDFDocument.create();
pdf.setTitle(`${restaurant.name} — table QR kit`);
pdf.setAuthor(restaurant.name);
pdf.setSubject("Scan to view menu & order");
pdf.setCreator("MenuPilot");

const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const regular = await pdf.embedFont(StandardFonts.Helvetica);

// The logo is square with a solid background, so it crops to a circle cleanly by
// being drawn inside a white disc.
const logoBytes = readFileSync(path.join(process.cwd(), "public/seed-images/logo-mati.png"));
const logo = await pdf.embedPng(logoBytes);

const totalPages = 1 + Math.ceil(tables.length / 4); // cover + 4 cards per sheet

function footer(page: import("pdf-lib").PDFPage, n: number) {
  page.drawLine({
    start: { x: 48, y: 44 },
    end: { x: A4.w - 48, y: 44 },
    thickness: 0.5,
    color: LINE,
  });
  page.drawText(`${restaurant!.name} · table QR kit`, {
    x: 48,
    y: 30,
    size: 7.5,
    font: regular,
    color: INK_SOFT,
  });
  const label = `${n} / ${totalPages}`;
  page.drawText(label, {
    x: A4.w - 48 - regular.widthOfTextAtSize(label, 7.5),
    y: 30,
    size: 7.5,
    font: regular,
    color: INK_SOFT,
  });
}

/* ---- page 1: cover + overview of all twenty ------------------------- */

{
  const page = pdf.addPage([A4.w, A4.h]);
  page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: WHITE });

  page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: CLAY });

  page.drawImage(logo, { x: 48, y: A4.h - 128, width: 52, height: 52 });
  page.drawText(restaurant.name, { x: 112, y: A4.h - 96, size: 22, font: bold, color: INK });
  page.drawText(restaurant.tagline ?? "Scan to view menu & order", {
    x: 112,
    y: A4.h - 113,
    size: 9.5,
    font: regular,
    color: INK_SOFT,
  });

  page.drawText("TABLE QR KIT", { x: 48, y: A4.h - 162, size: 9, font: bold, color: CLAY });
  page.drawText("Twenty tables, one QR code each", {
    x: 48,
    y: A4.h - 180,
    size: 14,
    font: bold,
    color: INK,
  });
  page.drawText(
    "Cut out the cards on the following pages and place one on each table. A guest scans it",
    { x: 48, y: A4.h - 196, size: 8.5, font: regular, color: INK_SOFT },
  );
  page.drawText(
    "with their phone camera to open that table's menu and order — no app needed.",
    { x: 48, y: A4.h - 208, size: 8.5, font: regular, color: INK_SOFT },
  );

  if (originIsLocal) {
    page.drawRectangle({ x: 48, y: A4.h - 240, width: A4.w - 96, height: 22, color: rgb(0.99, 0.93, 0.86) });
    page.drawText(
      "LOCAL BUILD — these codes point at localhost and will not open on a phone. Rebuild with a public --origin.",
      { x: 56, y: A4.h - 234, size: 7.5, font: bold, color: CLAY },
    );
  }

  // Overview grid: 4 columns x 5 rows of small codes, so the whole set can be
  // eyeballed on one sheet.
  // Overview grid: 5 columns x 4 rows. The code and its label are laid out from
  // known offsets rather than relative to the cell top, so the QR can never
  // overlap the box edge or the caption at any row.
  const cols = 5;
  const cellW = (A4.w - 96) / cols;
  const cellH = 104;
  const cellPad = 6;
  const boxW = cellW - 12;
  const boxH = cellH - 14;
  const qrSize = 54;
  const top = A4.h - (originIsLocal ? 300 : 276);

  for (const [i, table] of tables.entries()) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = 48 + col * cellW;
    const cellTop = top - row * cellH;
    const boxX = cellX + cellPad;
    const boxBottom = cellTop - boxH;

    page.drawRectangle({
      x: boxX,
      y: boxBottom,
      width: boxW,
      height: boxH,
      borderColor: LINE,
      borderWidth: 0.5,
    });

    const png = await pdf.embedPng(await qrPng(`${origin}/q/${table.token}`, 240));
    page.drawImage(png, {
      x: boxX + (boxW - qrSize) / 2,
      y: boxBottom + boxH - qrSize - 7,
      width: qrSize,
      height: qrSize,
    });

    const label = table.label;
    page.drawText(label, {
      x: boxX + (boxW - bold.widthOfTextAtSize(label, 8)) / 2,
      y: boxBottom + 7,
      size: 8,
      font: bold,
      color: INK,
    });
  }

  footer(page, 1);
}

/* ---- pages 2+: four cut-out cards per sheet ------------------------------ */

const cutSize = 130; // pt — comfortably large for a phone camera to lock on

for (let p = 0; p < Math.ceil(tables.length / 4); p++) {
  const page = pdf.addPage([A4.w, A4.h]);
  page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: WHITE });

  const slice = tables.slice(p * 4, p * 4 + 4);

  for (const [i, table] of slice.entries()) {
    const col = i % 2;
    const row = Math.floor(i / 2);

    const margin = 40;
    const gap = 18;
    const cardW = (A4.w - margin * 2 - gap) / 2;
    const cardH = 320;
    const x = margin + col * (cardW + gap);
    const y = A4.h - 60 - (row + 1) * cardH - row * gap;

    // Dashed cut line
    page.drawRectangle({
      x,
      y,
      width: cardW,
      height: cardH,
      borderColor: LINE,
      borderWidth: 0.75,
      borderDashArray: [3, 3],
    });

    // Header band
    page.drawRectangle({ x, y: y + cardH - 26, width: cardW, height: 26, color: INK });
    page.drawText("SCAN TO VIEW MENU & ORDER", {
      x: x + 12,
      y: y + cardH - 17,
      size: 7.5,
      font: bold,
      color: WHITE,
    });

    // Logo + restaurant name
    page.drawImage(logo, { x: x + 12, y: y + cardH - 60, width: 26, height: 26 });
    page.drawText(restaurant.name, {
      x: x + 44,
      y: y + cardH - 49,
      size: 11,
      font: bold,
      color: INK,
    });
    page.drawText(restaurant.city ?? "Dine in", {
      x: x + 44,
      y: y + cardH - 61,
      size: 7.5,
      font: regular,
      color: INK_SOFT,
    });

    // The code itself, centred
    const png = await pdf.embedPng(await qrPng(`${origin}/q/${table.token}`, 600));
    page.drawImage(png, {
      x: x + (cardW - cutSize) / 2,
      y: y + 96,
      width: cutSize,
      height: cutSize,
    });

    // Table number, the most important line on the card
    const label = table.label;
    page.drawText(label, {
      x: x + (cardW - bold.widthOfTextAtSize(label, 26)) / 2,
      y: y + 58,
      size: 26,
      font: bold,
      color: INK,
    });

    const sub = [table.zone, table.seats ? `${table.seats} seats` : null].filter(Boolean).join(" · ");
    if (sub) {
      page.drawText(sub, {
        x: x + (cardW - regular.widthOfTextAtSize(sub, 8)) / 2,
        y: y + 44,
        size: 8,
        font: regular,
        color: INK_SOFT,
      });
    }

    page.drawLine({
      start: { x: x + 24, y: y + 34 },
      end: { x: x + cardW - 24, y: y + 34 },
      thickness: 0.5,
      color: LINE,
    });
    page.drawText("Point your phone camera at the code", {
      x: x + (cardW - regular.widthOfTextAtSize("Point your phone camera at the code", 7)) / 2,
      y: y + 20,
      size: 7,
      font: regular,
      color: INK_SOFT,
    });
  }

  footer(page, p + 2);
}

/* ---- write --------------------------------------------------------------- */

const bytes = await pdf.save();
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, bytes);

console.log(`restaurant   : ${restaurant.name} (${restaurant.id})`);
console.log(`tables       : ${tables.length}, tokens distinct: ${uniqueTokens.size}`);
console.log(`origin       : ${origin || "(empty)"}${originIsLocal ? "  <-- LOCAL ONLY" : ""}`);
console.log(`pages        : ${pdf.getPageCount()} (1 cover + ${Math.ceil(tables.length / 4)} card sheets)`);
console.log(`size         : ${(bytes.byteLength / 1024).toFixed(0)} KiB`);
console.log(`written to   : ${outPath}`);
process.exit(0);
