/** Desk-scoped Telegram rate limits. No sleeps — callers fail closed with 429. */
import { getSql } from "@/lib/db";
import { TelegramError } from "./errors";
import {
  USER_SEND_BURST,
  USER_SEND_BURST_MS,
  USER_SEND_DAY,
  USER_SEND_PER_MIN,
} from "./rate";

export { USER_SEND_BURST, USER_SEND_BURST_MS, USER_SEND_DAY, USER_SEND_PER_MIN };


function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Atomic insert + count in one statement. Prune is scoped to this desk so
 * concurrent isolates do not lock the whole telegram_rate_events table.
 */
export async function takeRate(
  userId: string,
  kind: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const sql = await getSql();
  const since = isoAgo(windowMs);
  const pruneBefore = isoAgo(24 * 60 * 60 * 1000);
  const rows = await sql.query<{ n: number }>(
    `with pruned as (
       delete from telegram_rate_events
        where user_id = $1 and at < $4
     ),
     ins as (
       insert into telegram_rate_events (user_id, kind) values ($1, $2)
       returning at
     )
     select count(*)::int as n
       from telegram_rate_events
      where user_id = $1 and kind = $2 and at >= $3`,
    [userId, kind, since, pruneBefore],
  );
  if ((rows[0]?.n ?? 0) > limit) {
    const wait = Math.max(1, Math.ceil(windowMs / 1000));
    throw new TelegramError("flood", `Telegram asked us to wait ${wait} seconds.`, 429, wait);
  }
}

function remainingSeconds(until: string | Date | null | undefined): number | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 1000));
}

/** Persist FLOOD_WAIT / AUTH_KEY death so the next isolate does not retry. */
export async function persistSendFault(userId: string, err: TelegramError): Promise<void> {
  const sql = await getSql();
  if (err.code === "auth_dead" || err.code === "unlinked") {
    await sql.query(
      `update telegram_user_sessions
          set auth_dead = true, watching = false, last_error = $2, updated_at = now()
        where user_id = $1`,
      [userId, err.message.slice(0, 240)],
    );
    return;
  }
  if (err.code === "peer_flood") {
    await sql.query(
      `update telegram_user_sessions
          set flood_until = now() + interval '1 day', last_error = $2, updated_at = now()
        where user_id = $1`,
      [userId, err.message.slice(0, 240)],
    );
    return;
  }
  if (err.code === "flood") {
    const seconds = Math.max(1, err.floodSeconds ?? 30);
    await sql.query(
      `update telegram_user_sessions
          set flood_until = greatest(coalesce(flood_until, now()), now() + ($2 || ' seconds')::interval),
              last_error = $3,
              updated_at = now()
        where user_id = $1`,
      [userId, String(seconds), err.message.slice(0, 240)],
    );
  }
}

/**
 * User-account MTProto send gate: burst 8 / 15 min + 80 / calendar day.
 * Also fail closed when flood_until or auth_dead is set.
 */
export async function takeUserSend(userId: string): Promise<void> {
  const sql = await getSql();
  const state = await sql.query<{
    flood_until: string | Date | null;
    auth_dead: boolean | null;
  }>(
    `select flood_until, auth_dead from telegram_user_sessions where user_id = $1`,
    [userId],
  );
  const row = state[0];
  if (row?.auth_dead) {
    throw new TelegramError("auth_dead", "Telegram signed this desk out. Connect again.", 401);
  }
  const wait = remainingSeconds(row?.flood_until);
  if (wait != null) {
    throw new TelegramError("flood", `Telegram asked us to wait ${wait} seconds.`, 429, wait);
  }

  await takeRate(userId, "user_send", USER_SEND_BURST, USER_SEND_BURST_MS);

  const bumped = await sql.query<{ send_day_count: number }>(
    `update telegram_user_sessions
        set send_day_key = case when send_day_key = current_date then send_day_key else current_date end,
            send_day_count = case when send_day_key = current_date then send_day_count + 1 else 1 end,
            updated_at = now()
      where user_id = $1
        and coalesce(auth_dead, false) = false
        and (flood_until is null or flood_until <= now())
        and (send_day_key is distinct from current_date or send_day_count < $2)
      returning send_day_count`,
    [userId, USER_SEND_DAY],
  );
  if (!bumped[0]) {
    throw new TelegramError(
      "flood",
      "Telegram asked us to wait. This desk hit today's send cap.",
      429,
      3600,
    );
  }
}
