/**
 * Engine-agnostic database contracts.
 *
 * MenuPilot talks to PostgreSQL through this narrow interface so the exact same
 * schema, RLS policies and SQL functions run against:
 *   - Supabase Postgres (production) via the `pg` driver (pooler connection), or
 *   - an embedded PostgreSQL 18 (PGlite) instance for local dev / CI / preview.
 *
 * Nothing above this layer knows which engine is in use.
 */

export type SqlParam = unknown;

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<QueryResult<T>>;
  /** Multi-statement DDL. Never pass user input. */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  /** Runs `fn` inside a single BEGIN/COMMIT with its own connection. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly engine: "postgres" | "pglite";
}

/** Who is executing a request. Mirrors Supabase's `anon` / `authenticated` / `service_role`. */
export type DbRole = "anon" | "authenticated" | "service_role";

export interface SessionContext {
  role: DbRole;
  userId: string | null;
  /** Extra claims propagated to `request.jwt.claims` (used for audit context). */
  claims?: Record<string, unknown>;
}

export const ANON: SessionContext = { role: "anon", userId: null };
export const SERVICE: SessionContext = { role: "service_role", userId: null };
export const asUser = (userId: string): SessionContext => ({ role: "authenticated", userId });
