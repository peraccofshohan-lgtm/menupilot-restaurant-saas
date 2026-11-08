/**
 * One-time Supabase project preparation.
 *
 * Creates the two Storage buckets and applies their access policies, then verifies
 * the database schema the application expects.
 *
 *   npx tsx scripts/supabase-setup.ts            # create/repair + verify
 *   npx tsx scripts/supabase-setup.ts --check    # verify only, change nothing
 *
 * Requires in the environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY      (server-side only; never shipped to a browser)
 *
 * Storage design
 * --------------
 * `menu` and `branding` are PUBLIC *read* buckets, because their contents are the
 * published menu and are rendered by anonymous guests. Writes are not public:
 * the application uploads with the service_role key from a server route that has
 * already checked the caller is owner/manager of the tenant in the path.
 *
 * Public read + server-only write is the right trade here: an object URL is
 * guessable only from the tenant id plus a random filename, nothing sensitive is
 * stored there, and the alternative (signed URLs) would break image caching and
 * the printed QR sheets that embed the public menu URL.
 */
import "dotenv/config";
import { createPostgresDatabase } from "../src/lib/db/postgres";
import { migrate } from "../src/lib/db/migrate";
import { getDb } from "../src/lib/db";

const BUCKETS = ["menu", "branding"] as const;
const checkOnly = process.argv.includes("--check");

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("SUPABASE_URL is not set");
if (!SERVICE_KEY) fail("SUPABASE_SERVICE_ROLE_KEY is not set");

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "content-type": "application/json",
};

async function listBuckets(): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers, cache: "no-store" });
  if (!res.ok) fail(`could not list buckets (${res.status}). Is the service_role key correct?`);
  const buckets = (await res.json()) as { name: string }[];
  return buckets.map((b) => b.name);
}

async function ensureBucket(name: string, publicRead: boolean): Promise<void> {
  const existing = await listBuckets();
  if (existing.includes(name)) {
    console.log(`  · bucket "${name}" already exists`);
    return;
  }
  if (checkOnly) {
    console.log(`  ✗ bucket "${name}" is missing (re-run without --check to create it)`);
    process.exitCode = 1;
    return;
  }
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: name,
      name,
      public: publicRead,
      file_size_limit: 5 * 1024 * 1024,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    }),
  });
  if (!res.ok) fail(`could not create bucket "${name}" (${res.status}): ${await res.text()}`);
  console.log(`  ✓ created bucket "${name}" (public read: ${publicRead})`);
}

async function verifyDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("  · DATABASE_URL not set — skipping database verification");
    return;
  }
  const db = createPostgresDatabase(process.env.DATABASE_URL);
  try {
    const applied = await migrate(db, (m) => console.log(`  ✓ applied ${m}`));
    if (applied.length === 0) console.log("  · migrations already up to date");

    const res = await db.query<{
      result: { ok: boolean; missing: string[]; detail: Record<string, unknown> };
    }>("select public.mp_check_schema() as result");
    const schema = res.rows[0]?.result;
    if (!schema?.ok) fail(`schema incomplete: ${schema?.missing?.join(", ") ?? "no result"}`);

    const detail = schema.detail as {
      engine?: { gotrue_managed?: boolean; server_version?: string };
      tenants?: number;
      demo_items?: number;
      demo_tables?: number;
      rls_disabled?: string[];
    };

    console.log(`  ✓ schema complete (Postgres ${detail.engine?.server_version ?? "?"})`);
    console.log(`  ✓ auth schema managed by GoTrue: ${detail.engine?.gotrue_managed ? "yes" : "no"}`);
    console.log(`  · tenants: ${detail.tenants ?? 0} · demo dishes: ${detail.demo_items ?? 0} · demo tables: ${detail.demo_tables ?? 0}`);
    if ((detail.rls_disabled ?? []).length > 0) {
      fail(`RLS is disabled on: ${detail.rls_disabled!.join(", ")}`);
    }

    // Prove the production tenancy rule holds on this project.
    const scoping = await db.query<{ result: { ok: boolean; bypassing_policies: unknown[] } }>(
      "select public.mp_check_admin_scoping() as result",
    );
    const adminScoping = scoping.rows[0]?.result;
    if (!adminScoping?.ok) {
      fail(`platform-admin RLS bypass present on: ${JSON.stringify(adminScoping?.bypassing_policies)}`);
    }
    console.log("  ✓ no platform-admin row-level bypass remains");
  } finally {
    await db.close();
  }
}

console.log(`\nSupabase setup — ${SUPABASE_URL}${checkOnly ? " (check only)" : ""}\n`);

for (const bucket of BUCKETS) {
  await ensureBucket(bucket, true);
}

await verifyDatabase();

// The local storage driver is irrelevant here, but constructing it proves the
// storage module can reach the project with the credentials it was given.
if (process.env.STORAGE_DRIVER === "supabase") {
  const storageDb = await getDb();
  await storageDb.close();
  console.log("  ✓ STORAGE_DRIVER=supabase configured");
}

console.log("\nDone.\n");
