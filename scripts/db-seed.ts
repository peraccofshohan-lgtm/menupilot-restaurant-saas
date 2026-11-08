import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getDb } from "../src/lib/db";
import { migrate } from "../src/lib/db/migrate";
import { seedDemo } from "../src/lib/seed/seed";

// One shared instance for migration + seed + storage uploads.
const db = await getDb();
await migrate(db, (m) => console.log(`  ✓ ${m}`));

const result = await seedDemo({ reset: process.argv.includes("--reset") });

console.log(`\nMATI Kitchen ready`);
console.log(`  restaurant : /menu/${result.slug}`);
console.log(`  categories : ${result.categories}`);
console.log(`  dishes     : ${result.items}`);
console.log(`  tables     : ${result.tables}`);
console.log(`  orders     : ${result.orders}`);
console.log(`  photos     : ${result.items - (result.missingPhotos?.length ?? 0)}/${result.items}`);
if (result.missingPhotos && result.missingPhotos.length > 0) {
  console.log(`  \x1b[33mno photo   : ${result.missingPhotos.length} dish(es) fell back to the ChefHat placeholder[0m`);
  for (const name of result.missingPhotos) console.log(`             · ${name}`);
}
console.log(`  owner      : ${result.ownerEmail}`);
console.log(`  admin      : ${result.adminEmail}`);
if (result.generatedPassword) {
  await mkdir(path.join(process.cwd(), ".data"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), ".data", "demo-credentials.txt"),
    [
      "MenuPilot demo credentials — generated locally, never committed.",
      "",
      `owner   : ${result.ownerEmail} / ${result.generatedPassword}`,
      `kitchen : ${process.env.DEMO_KITCHEN_EMAIL || "kitchen@mati.demo"} / ${result.generatedPassword}`,
      `admin   : ${result.adminEmail} / ${result.generatedPassword}`,
      "",
      "Set DEMO_OWNER_PASSWORD to choose your own password before seeding.",
      "",
    ].join("\n"),
  );
  console.log(`  password   : .data/demo-credentials.txt`);
}
await db.close();
