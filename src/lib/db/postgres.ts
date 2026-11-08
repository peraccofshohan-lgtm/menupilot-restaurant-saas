import { Pool, type PoolClient } from "pg";
import type { Database, Queryable, QueryResult, SqlParam } from "./types";

function wrap(client: PoolClient): Queryable {
  return {
    async query<T>(sql: string, params: SqlParam[] = []): Promise<QueryResult<T>> {
      const res = await client.query(sql, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  };
}

export function createPostgresDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? undefined
      : { rejectUnauthorized: false },
  });

  return {
    engine: "postgres",
    async query<T>(sql: string, params: SqlParam[] = []): Promise<QueryResult<T>> {
      const res = await pool.query(sql, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(wrap(client));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
