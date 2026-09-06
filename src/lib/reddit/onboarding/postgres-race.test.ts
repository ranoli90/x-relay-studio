import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * RC-001 PostgreSQL transaction affinity.
 *
 * Skips unless `REDDIT_TEST_DATABASE_URL` is set. Ordinary CI must not require
 * live Postgres. This file does not import `./sql.ts` / `../../db.ts` because
 * those modules use extensionless Vite imports that fail under `node --test`.
 */

const TEST_DATABASE_URL = process.env.REDDIT_TEST_DATABASE_URL?.trim() ?? "";

type SqlLike = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function skipReason(): string {
  return "RC-001 skipped: REDDIT_TEST_DATABASE_URL is unset. Live Postgres is not required in CI.";
}

async function withCheckedOutClient<T>(
  pool: import("pg").Pool,
  fn: (sql: SqlLike) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const sql: SqlLike = {
    query: async <R>(text: string, params: unknown[] = []) => {
      const res = await client.query(text, params);
      return res.rows as R[];
    },
  };
  try {
    await client.query("BEGIN");
    try {
      const result = await fn(sql);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* keep original */
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

describe("RC-001 PostgreSQL transaction affinity", () => {
  it("skips unless REDDIT_TEST_DATABASE_URL is set (CI must not require live Postgres)", (t) => {
    if (!TEST_DATABASE_URL) {
      t.skip(skipReason());
    }
  });

  it("RC-001: concurrent mutations on pool size >1 stay on one checked-out connection", async (t) => {
    if (!TEST_DATABASE_URL) {
      t.skip(skipReason());
      return;
    }

    const pg = await import("pg");
    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    try {
      const workers = 4;
      const results = await Promise.all(
        Array.from({ length: workers }, (_, i) =>
          withCheckedOutClient(pool, async (sql) => {
            const first = await sql.query<{ pid: number }>("select pg_backend_pid() as pid");
            const mid = await sql.query<{ pid: number }>("select pg_backend_pid() as pid");
            await sql.query("select 1");
            const last = await sql.query<{ pid: number }>("select pg_backend_pid() as pid");
            assert.equal(first[0]?.pid, mid[0]?.pid, `worker ${i} lost affinity after pin`);
            assert.equal(mid[0]?.pid, last[0]?.pid, `worker ${i} lost affinity inside tx`);
            await sql.query(`create temporary table rc001_w${i} (n int)`);
            await sql.query(`insert into rc001_w${i} values (1)`);
            const seen = await sql.query<{ n: number }>(`select n from rc001_w${i}`);
            assert.equal(seen[0]?.n, 1);
            return first[0]!.pid;
          }),
        ),
      );
      assert.equal(results.length, workers);
      for (const pid of results) assert.ok(Number.isInteger(pid) && pid > 0);
    } finally {
      await pool.end();
    }
  });

  it("RC-001: uncommitted writes on a pinned connection are invisible to the rest of the pool", async (t) => {
    if (!TEST_DATABASE_URL) {
      t.skip(skipReason());
      return;
    }

    const pg = await import("pg");
    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
    const marker = `rc001_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
      await pool.query("create table if not exists rc001_affinity_probe (id text primary key)");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("insert into rc001_affinity_probe (id) values ($1)", [marker]);
        const other = await pool.query("select id from rc001_affinity_probe where id = $1", [marker]);
        assert.equal(other.rowCount, 0, "pool sibling must not see an uncommitted pinned write");
        const same = await client.query("select id from rc001_affinity_probe where id = $1", [marker]);
        assert.equal(same.rowCount, 1);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    } finally {
      await pool.query("drop table if exists rc001_affinity_probe").catch(() => undefined);
      await pool.end();
    }
  });
});
