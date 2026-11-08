import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable, QueryResult, SqlParam } from "./types";

function wrap(target: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
}): Queryable {
  return {
    async query<T>(sql: string, params: SqlParam[] = []): Promise<QueryResult<T>> {
      const res = await target.query(sql, params);
      return { rows: res.rows as T[], rowCount: res.affectedRows ?? res.rows.length };
    },
    async exec(sql: string) {
      await target.exec(sql);
    },
  };
}

export async function createPgliteDatabase(dataDir: string): Promise<Database> {
  await mkdir(path.dirname(dataDir), { recursive: true });
  const pg = await PGlite.create({ dataDir });
  return {
    engine: "pglite",
    ...wrap(pg),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => fn(wrap(tx)));
    },
    async close() {
      await pg.close();
    },
  };
}
