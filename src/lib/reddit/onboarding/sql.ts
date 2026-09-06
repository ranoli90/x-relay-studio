import { AsyncLocalStorage } from "node:async_hooks";

export type SqlLike = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

type PoolClient = {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] } | unknown[]>;
  release(err?: boolean | Error): void;
};

type PgPool = {
  connect(): Promise<PoolClient>;
  query?(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  on?(event: string, listener: (err: Error) => void): void;
  end?(): Promise<void>;
};

type PoolSql = SqlLike & {
  __isPool: true;
  __pool: PgPool;
  withTransaction<T>(fn: (sql: SqlLike) => Promise<T>): Promise<T>;
};

const txAls = new AsyncLocalStorage<SqlLike>();

export function currentTxSql(): SqlLike | undefined {
  return txAls.getStore();
}

function isPoolSql(sql: SqlLike): sql is PoolSql {
  return Boolean((sql as PoolSql).__isPool && (sql as PoolSql).__pool);
}

function rowsOf<T>(res: { rows: unknown[] } | unknown[]): T[] {
  if (Array.isArray(res)) return res as T[];
  return (res.rows ?? []) as T[];
}

/**
 * Run `fn` on one checked-out connection. Nested calls reuse the same handle.
 * A sequence of BEGIN/COMMIT through a pool is not a transaction — this is.
 */
export async function withSqlTransaction<T>(
  sql: SqlLike,
  fn: (sql: SqlLike) => Promise<T>,
): Promise<T> {
  const existing = txAls.getStore();
  if (existing) return fn(existing);

  if (isPoolSql(sql)) {
    const client = await sql.__pool.connect();
    const pinned: SqlLike = {
      query: async <R = Record<string, unknown>>(text: string, params: unknown[] = []) => {
        const res = await client.query(text, params);
        return rowsOf<R>(res);
      },
    };
    try {
      await pinned.query("begin");
      try {
        const result = await txAls.run(pinned, () => fn(pinned));
        await pinned.query("commit");
        return result;
      } catch (err) {
        try {
          await pinned.query("rollback");
        } catch {
          try {
            client.release(true);
          } catch {
            /* already gone */
          }
          throw err;
        }
        throw err;
      }
    } finally {
      try {
        client.release();
      } catch {
        /* released above */
      }
    }
  }

  await sql.query("begin");
  try {
    const result = await txAls.run(sql, () => fn(sql));
    await sql.query("commit");
    return result;
  } catch (err) {
    try {
      await sql.query("rollback");
    } catch {
      /* keep original */
    }
    throw err;
  }
}

/** Production mutations: pin via db.withTransaction and mark the onboarding ALS. */
export async function runOnboardingTx<T>(fn: (sql: SqlLike) => Promise<T>): Promise<T> {
  const existing = txAls.getStore();
  if (existing) return fn(existing);
  const { withTransaction } = await import("../../db.ts");
  return withTransaction(async (sql) => txAls.run(sql, () => fn(sql)));
}

/** Wrap a node-postgres Pool so ordinary queries go through the pool and mutations can pin a client. */
export function sqlFromPool(pool: PgPool): PoolSql {
  const sql = {
    __isPool: true as const,
    __pool: pool,
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const tx = txAls.getStore();
      if (tx) return tx.query<T>(text, params);
      if (typeof pool.query === "function") {
        const res = await pool.query(text, params);
        return rowsOf<T>(res);
      }
      const client = await pool.connect();
      try {
        const res = await client.query(text, params);
        return rowsOf<T>(res);
      } finally {
        client.release();
      }
    },
    withTransaction<T>(fn: (inner: SqlLike) => Promise<T>) {
      return withSqlTransaction(sql, fn);
    },
  };
  return sql;
}

export function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unique|duplicate/i.test(msg);
}
