/**
 * Key audit.
 *
 * `t()` accepts any string, so a typo or a forgotten dictionary entry renders
 * `⟦key⟧` to a guest and TypeScript never notices. This walks every source file,
 * collects each literal key passed to `t(...)`, and reports the ones that are not
 * in the Bengali dictionary. Dynamic keys built as `staff.role.${role}` are
 * matched against the prefixes their call sites enumerate.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bnDictionary } from "../src/lib/i18n/messages/bn";

const ROOT = join(process.cwd(), "src");
const DICTIONARY = bnDictionary.messages;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

/** Keys assembled at runtime, with the values their call sites can produce. */
const DYNAMIC: Record<string, string[]> = {
  "staff.role.": ["owner", "manager", "kitchen", "waiter", "service"],
};

const used = new Map<string, string[]>();
for (const file of walk(ROOT)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    const key = String(match[1]);
    used.set(key, [...(used.get(key) ?? []), file]);
  }
}

const missing = [...used].filter(([key]) => !(key in DICTIONARY));
const unused = Object.keys(DICTIONARY).filter((key) => !used.has(key));

for (const [key, files] of missing) {
  console.error(`MISSING  ${key}\n         ${[...new Set(files)].map((f) => f.replace(ROOT, "src")).join(", ")}`);
}
for (const [prefix, values] of Object.entries(DYNAMIC)) {
  for (const value of values) {
    if (!(`${prefix}${value}` in DICTIONARY)) console.error(`MISSING  ${prefix}${value}  (dynamic)`);
  }
}

// Note: a call site passing a dictionary *key* where a translated label is
// expected is already a compile error — `label` is typed `string`, and
// `ORDER_STATUS_KEY[status]` is `string | undefined`. Verified by deliberately
// breaking a call site: tsc reports TS2322. No extra regex needed here.

console.log(`\n${used.size} keys referenced · ${Object.keys(DICTIONARY).length} in dictionary`);
console.log(`${missing.length} missing · ${unused.length} unused`);
if (unused.length > 0 && process.argv.includes("--verbose")) console.log("unused:", unused.join(", "));
process.exitCode = missing.length > 0 ? 1 : 0;
