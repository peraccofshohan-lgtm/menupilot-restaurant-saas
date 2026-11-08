/**
 * Migration runner.
 *
 * Applies every `migrations/*.sql` file in filename order inside one transaction
 * per file, recording applied versions in `schema_migrations`. Works against both
 * Supabase Postgres and the embedded engine, and is idempotent.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

export async function migrate(db: Database, log: (msg: string) => void = () => {}): Promise<string[]> {
  await db.exec(`
    create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await db.query<{ version: string }>("select version from public.schema_migrations")).rows.map(
      (r) => r.version,
    ),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    log(`applying ${file}`);
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into public.schema_migrations (version) values ($1)", [file]);
    });
    ran.push(file);
  }
  return ran;
}
