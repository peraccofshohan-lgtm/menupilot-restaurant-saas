/**
 * Mints session tokens for the demo accounts so end-to-end checks can drive the
 * authenticated owner/kitchen/admin APIs.
 *
 * Run this with the dev server STOPPED — PGlite is single-writer, so writing
 * sessions from a second process while the app holds the directory risks the
 * same WAL tear that took down the previous demo database.
 */
import { signIn } from "../src/lib/auth/session";
import { writeFileSync } from "node:fs";

const accounts = [
  ["owner", "owner@mati.demo"],
  ["kitchen", "kitchen@mati.demo"],
  ["admin", "admin@menupilot.demo"],
] as const;

const password = process.env.DEMO_OWNER_PASSWORD;
if (!password) {
  console.error("DEMO_OWNER_PASSWORD is not set — refusing to mint sessions.");
  console.error("Run as: DEMO_OWNER_PASSWORD=<demo password> npx tsx scripts/demo-sessions.ts");
  process.exit(1);
}

const out: Record<string, string> = {};
for (const [role, email] of accounts) {
  const r = await signIn(email, password);
  out[role] = r.token;
  console.log(`${role.padEnd(8)} session ok (${r.token.length} chars)`);
}
writeFileSync(".data/demo-sessions.json", JSON.stringify(out, null, 2));
console.log("\nwritten to .data/demo-sessions.json (git-ignored)");
process.exit(0);
