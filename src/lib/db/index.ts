import path from "node:path";
import type { Database, SessionContext } from "./types";

/**
 * Single database handle per process.
 *
 * Resolution order:
 *   1. DATABASE_URL            → external PostgreSQL (Supabase pooler / any PG)
 *   2. DATABASE_PGLITE_DIR     → embedded Postgres (default for local/preview/CI)
 *
 * Both engines execute the exact same migrations, including RLS policies.
 */
const globalForDb = globalThis as unknown as {
  __menupilotDb?: Promise<Database>;
};

async function createDatabase(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { createPostgresDatabase } = await import("./postgres");
    return createPostgresDatabase(url);
  }
  const { createPgliteDatabase } = await import("./pglite");
  const dir = process.env.DATABASE_PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
  return createPgliteDatabase(dir);
}

export function getDb(): Promise<Database> {
  if (!globalForDb.__menupilotDb) {
    globalForDb.__menupilotDb = createDatabase();
  }
  return globalForDb.__menupilotDb;
}

/**
 * Runs `fn` inside one transaction with the request's database identity.
 *
 * `SET LOCAL ROLE` + `request.jwt.claims` reproduce exactly what PostgREST does
 * on Supabase, so the same RLS policies decide access on every engine. Application
 * code can never accidentally widen access: if a query is not allowed by policy,
 * PostgreSQL raises.
 */
export async function withSession<T>(
  session: SessionContext,
  fn: (tx: import("./types").Queryable) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const claims = {
      sub: session.userId ?? undefined,
      role: session.role,
      ...(session.claims ?? {}),
    };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${session.role}`);
    try {
      return await fn(tx);
    } finally {
      // A denied query aborts the transaction; never let cleanup mask the real error.
      await tx.query("reset role", []).catch(() => undefined);
    }
  });
}

/** Convenience: run a single statement as a session. */
export async function queryAs<T>(
  session: SessionContext,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await withSession(session, (tx) => tx.query<T>(sql, params));
  return res.rows;
}
