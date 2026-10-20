import { Pool } from "pg";
import { normalizeDatabaseUrl } from "./database-url";
import type { Db, Q } from "./pg";

const g = globalThis as unknown as { __callsdashPool?: Pool };

/** Production database: Supabase Postgres over its pooled connection string (DATABASE_URL, service role). */
export function createNodePgDb(rawUrl: string): Db {
  const url = normalizeDatabaseUrl(rawUrl);
  const pool = (g.__callsdashPool ??= new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 5), ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } }));
  const q: Q = async (sql, params) => (await pool.query(sql, params as unknown[])).rows;
  return {
    q,
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        const out = await fn(async (sql, params) => (await c.query(sql, params as unknown[])).rows);
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
