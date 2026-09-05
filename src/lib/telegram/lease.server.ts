/** Per-desk MTProto mutex. Never reuse the cron lock key 0x58524c59. */
import { getSql } from "@/lib/db";
import { TelegramError } from "./errors";

/** Two-arg classid TGMP. Distinct from jobs/lock.ts single-key 0x58524c59. */
const LEASE_CLASS = 0x54474d50;
const LEASE_SECONDS = 25;

function deskObjId(userId: string): number {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function busy(): TelegramError {
  return new TelegramError(
    "flood",
    "Telegram is already busy on this desk. Try again in a moment.",
    429,
    2,
  );
}

/**
 * Row lease first (works across pooled Neon connections), then a two-key
 * advisory lock as a same-connection fast path. Always release both.
 */
export async function withMtprotoLease<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const sql = await getSql();
  const claimed = await sql.query<{ user_id: string }>(
    `update telegram_user_sessions
        set lease_until = now() + ($2 || ' seconds')::interval, updated_at = now()
      where user_id = $1
        and (lease_until is null or lease_until <= now())
      returning user_id`,
    [userId, String(LEASE_SECONDS)],
  );
  if (!claimed[0]) throw busy();

  const obj = deskObjId(userId);
  let advisory = false;
  try {
    const rows = await sql.query<{ locked: boolean }>(
      `select pg_try_advisory_lock($1, $2) as locked`,
      [LEASE_CLASS, obj],
    );
    advisory = Boolean(rows[0]?.locked);
    return await fn();
  } finally {
    if (advisory) {
      try {
        await sql.query(`select pg_advisory_unlock($1, $2)`, [LEASE_CLASS, obj]);
      } catch {
        /* connection dying */
      }
    }
    try {
      await sql.query(
        `update telegram_user_sessions set lease_until = null, updated_at = now() where user_id = $1`,
        [userId],
      );
    } catch {
      /* lease expires on lease_until even if this fails */
    }
  }
}
