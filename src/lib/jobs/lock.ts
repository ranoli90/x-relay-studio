import { newId } from "../agent/ids.ts";

/**
 * Named row lease. Session advisory locks are not used — Neon/PgBouncer
 * transaction pooling does not pin them to this request.
 */
const DEFAULT_SECONDS = 120;
export const CRON_LEASE_NAME = "cron:studio";

type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type CronLockResult<T> = {
  ran: boolean;
  result?: T;
};

export async function claimAppLease(
  sql: Sql,
  name: string,
  owner: string,
  seconds = DEFAULT_SECONDS,
): Promise<boolean> {
  await sql.query(
    `insert into app_leases (name, owner, until) values ($1, null, null)
     on conflict (name) do nothing`,
    [name],
  );
  const row = await sql.query<{ name: string }>(
    `update app_leases
        set owner = $1, until = now() + ($2::int * interval '1 second')
      where name = $3
        and (until is null or until <= now())
      returning name`,
    [owner, seconds, name],
  );
  return Boolean(row[0]);
}

/** Compare-and-release: a stale owner cannot clear a newer owner's lease. */
export async function releaseAppLease(sql: Sql, name: string, owner: string): Promise<boolean> {
  const row = await sql.query<{ name: string }>(
    `update app_leases set owner = null, until = null
      where name = $1 and owner = $2
      returning name`,
    [name, owner],
  );
  return Boolean(row[0]);
}

export async function withCronLock<T>(fn: () => Promise<T>): Promise<CronLockResult<T>> {
  const { getSql, withTransaction } = await import("@/lib/db");
  const owner = newId("cron");
  const claimed = await withTransaction(async (sql) =>
    claimAppLease(sql, CRON_LEASE_NAME, owner, DEFAULT_SECONDS),
  );
  if (!claimed) return { ran: false };
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    const sql = await getSql();
    await releaseAppLease(sql, CRON_LEASE_NAME, owner);
  }
}
