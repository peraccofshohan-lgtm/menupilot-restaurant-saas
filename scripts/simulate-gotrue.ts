/**
 * Simulates a Supabase-shaped database and asserts the migrations still work.
 *
 * Why this exists
 * ---------------
 * Every test in this repository runs against a database where migration 001 created
 * `auth.users` itself — with the columns we chose. A real Supabase project's
 * `auth.users` is created by GoTrue and has a *different* shape: no `full_name`, no
 * `phone`, no `last_sign_in_at` on some versions, and it is owned by GoTrue's role.
 *
 * That difference is invisible to the rest of the suite. Running the migrations
 * against a faithful stand-in is the only way to catch it without a live project —
 * and it already caught a real defect: `staff_directory()` read `u.full_name`, which
 * does not exist on Supabase (fixed in migration 012).
 *
 * What it reproduces
 * ------------------
 *   * an `auth` schema owned by a non-superuser role (goTrue's `supabase_auth_admin`)
 *   * `auth.users` with GoTrue's columns only — display name in `raw_user_meta_data`
 *   * `auth.sessions` with GoTrue's unrelated shape (not our token table)
 *   * a database where 001's `create index` / 002's `revoke` must NOT be issued
 *
 * Usage:
 *   npx tsx scripts/simulate-gotrue.ts
 *
 * Exit code 0 means: all migrations applied, the schema check passed, GoTrue was
 * detected, and the identity functions read a display name out of `raw_user_meta_data`
 * correctly. Any failure exits non-zero.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPgliteDatabase } from "../src/lib/db/pglite";
import { migrate } from "../src/lib/db/migrate";

interface Result {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Result[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
}

const dir = await mkdtemp(path.join(tmpdir(), "menupilot-gotrue-"));
const db = await createPgliteDatabase(dir);

try {
  console.log("\n  MenuPilot — GoTrue-shaped database simulation\n");

  // --------------------------------------------------------------------------
  // 1. Build a Supabase-like auth schema.
  // --------------------------------------------------------------------------
  await db.exec("create role gotrue_owner nologin");
  await db.exec("create schema if not exists auth authorization gotrue_owner");

  // GoTrue's shape. Note: no full_name, no phone, no last_sign_in_at.
  await db.exec(`
    create table auth.users (
      instance_id uuid,
      id uuid primary key default gen_random_uuid(),
      aud text,
      role text,
      email text,
      encrypted_password text,
      email_confirmed_at timestamptz,
      invited_at timestamptz,
      confirmation_token text,
      raw_app_meta_data jsonb,
      raw_user_meta_data jsonb,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )`);
  await db.exec("alter table auth.users owner to gotrue_owner");

  // GoTrue's sessions table means something entirely different from ours.
  await db.exec(`
    create table auth.sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid,
      created_at timestamptz,
      updated_at timestamptz,
      factor_id uuid,
      aal text,
      refreshed_at timestamptz,
      not_after timestamptz
    )`);
  await db.exec("alter table auth.sessions owner to gotrue_owner");
  check("built a GoTrue-shaped auth schema", true, "auth owned by gotrue_owner");

  // --------------------------------------------------------------------------
  // 2. Apply every migration against it.
  // --------------------------------------------------------------------------
  let applied: string[] = [];
  try {
    applied = await migrate(db);
    check("all migrations applied", true, `${applied.length} migrations`);
  } catch (error) {
    check("all migrations applied", false, error instanceof Error ? error.message : String(error));
    throw error;
  }

  // --------------------------------------------------------------------------
  // 3. The provisioning check must recognise the project as GoTrue-managed.
  // --------------------------------------------------------------------------
  const schema = await db
    .query<{ result: { ok: boolean; missing: string[]; detail: { engine?: { gotrue_managed?: boolean } } } }>(
      "select public.mp_check_schema() as result",
    )
    .then((r) => r.rows[0]?.result)
    .catch(() => null);
  check("mp_check_schema() reports a complete schema", Boolean(schema?.ok), schema?.missing?.join(", ") || "no gaps");
  check(
    "GoTrue ownership is detected",
    schema?.detail?.engine?.gotrue_managed === true,
    "the app knows to keep its hands off auth",
  );

  // --------------------------------------------------------------------------
  // 4. Browser roles must not hold privileges on the auth schema.
  // --------------------------------------------------------------------------
  const grants = await db.query<{ grantee: string }>(
    `select grantee from information_schema.role_usage_grants
      where object_schema = 'auth' and object_type = 'SCHEMA'
        and grantee in ('anon','authenticated')`,
  );
  check("browser roles hold no usage on schema auth", grants.rows.length === 0, `${grants.rows.length} grants`);

  const tableGrants = await db.query<{ n: number }>(
    `select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'auth' and grantee in ('anon','authenticated')`,
  );
  check(
    "browser roles hold no grants on auth tables",
    Number(tableGrants.rows[0]?.n ?? 0) === 0,
    `${tableGrants.rows[0]?.n ?? 0} grants`,
  );

  // --------------------------------------------------------------------------
  // 5. Identity functions must resolve a name from raw_user_meta_data.
  // --------------------------------------------------------------------------
  const ownerId = "11111111-1111-1111-1111-111111111111";
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, 'gotrue-owner@example.test', '{"full_name":"GoTrue Owner","phone":"+8801000000000"}')`,
    [ownerId],
  );
  const rest = await db.query<{ id: string }>(
    `insert into public.restaurants (name, slug, status, currency, time_zone, created_by)
     values ('Sim Kitchen', 'sim-kitchen', 'active', 'BDT', 'Asia/Dhaka', $1) returning id`,
    [ownerId],
  );
  const restaurantId = rest.rows[0]!.id;
  await db.query(`insert into public.restaurant_members (restaurant_id, user_id, role) values ($1,$2,'owner')`, [
    restaurantId,
    ownerId,
  ]);

  const directory = await db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ownerId, role: "authenticated" }),
    ]);
    await tx.exec("set local role authenticated");
    const res = await tx.query<{ d: { full_name: string | null; phone: string | null; email: string }[] }>(
      "select public.staff_directory($1) as d",
      [restaurantId],
    );
    await tx.query("reset role", []).catch(() => undefined);
    return res.rows[0]?.d ?? [];
  });

  const member = directory[0];
  check("staff_directory() runs as an authenticated member", Boolean(member), member?.email);
  check(
    "display name comes from raw_user_meta_data",
    member?.full_name === "GoTrue Owner",
    `got ${JSON.stringify(member?.full_name)}`,
  );
  check("phone comes from raw_user_meta_data", member?.phone === "+8801000000000", `got ${JSON.stringify(member?.phone)}`);

  // --------------------------------------------------------------------------
  // 6. Application sign-in must work on this shape too.
  // --------------------------------------------------------------------------
  const { hashPassword } = await import("../src/lib/auth/password");
  await db.query(
    `insert into public.user_credentials (user_id, password_hash, full_name) values ($1,$2,'App Owner')`,
    [ownerId, await hashPassword("TestPass123")],
  );
  (globalThis as unknown as { __menupilotDb?: Promise<unknown> }).__menupilotDb = Promise.resolve(db);
  const { signIn } = await import("../src/lib/auth/session");
  let token: string | null = null;
  let signInError: string | null = null;
  try {
    token = (await signIn("gotrue-owner@example.test", "TestPass123")).token;
  } catch (error) {
    signInError = error instanceof Error ? error.message : String(error);
  }
  check("signIn() works with credentials in public.user_credentials", Boolean(token), signInError ?? "session created");

  const sessionRows = await db.query<{ n: number }>("select count(*)::int as n from public.app_sessions");
  check("the session landed in public.app_sessions", Number(sessionRows.rows[0]?.n ?? 0) === 1, "not in auth.sessions");
} catch (error) {
  if (!results.some((r) => !r.ok)) {
    check("simulation completed", false, error instanceof Error ? error.message : String(error));
  }
} finally {
  await db.close();
  await rm(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n  ${results.length - failed.length} passed, ${failed.length > 0 ? `\x1b[31m${failed.length} failed\x1b[0m` : "0 failed"}\n`,
);
process.exit(failed.length > 0 ? 1 : 0);
