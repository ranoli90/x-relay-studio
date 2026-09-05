import { getSql } from "@/lib/db";

/**
 * Postgres advisory lock so overlapping Vercel cron invocations do not
 * scrape / drip the same desks twice. PGLite preview is single-process;
 * the lock becomes a no-op mutex in that case.
 */

const CRON_LOCK_KEY = 0x58524c59; // "XRLY"

export type CronLockResult<T> = {
  ran: boolean;
  result?: T;
};

export async function withCronLock<T>(fn: () => Promise<T>): Promise<CronLockResult<T>> {
  const sql = await getSql();
  const rows = await sql<{ locked: boolean }>`
    select pg_try_advisory_lock(${CRON_LOCK_KEY}) as locked
  `;
  const locked = Boolean(rows[0]?.locked);
  if (!locked) return { ran: false };
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    try {
      await sql`select pg_advisory_unlock(${CRON_LOCK_KEY})`;
    } catch {
      /* process is exiting; lock dies with the connection */
    }
  }
}
