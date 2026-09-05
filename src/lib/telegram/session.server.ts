import { getSql } from "@/lib/db";
import { emptyCheckResults, parseChecksJson, type TelegramCheckResult } from "./checks";
import { decryptSecret, encryptSecret } from "./crypto.server";
import { TelegramError } from "./errors";
import { seizeSessionGeneration, wipeDisconnectedSession } from "./lease";
import { maskPhone } from "./phone";
import type { TelegramOnboardingStep, TelegramWatch } from "./types";

export type UserSessionRow = {
  user_id: string;
  api_id: number;
  api_hash_enc: string;
  phone: string;
  phone_code_hash_enc: string | null;
  session_enc: string | null;
  needs_password: boolean;
  watching: boolean;
  last_sync_at: string | Date | null;
  last_sync_ok_at?: string | Date | null;
  last_error: string | null;
  chats_watched: number;
  messages_ingested: number;
  openrouter_key_enc: string | null;
  openrouter_ok_at: string | Date | null;
  automation_armed: boolean;
  checks_json: string | null;
  onboarded_at: string | Date | null;
  flood_until?: string | Date | null;
  auth_dead?: boolean;
  lease_owner?: string | null;
  account_generation?: number;
};

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function deriveUserStep(row: UserSessionRow | null): TelegramOnboardingStep {
  if (!row) return "welcome";
  if (!row.session_enc && !row.phone_code_hash_enc && !row.phone) return "welcome";
  if (row.needs_password) return "password";
  if (row.phone_code_hash_enc) return "code";
  if (!row.session_enc) return "phone";
  if (!row.onboarded_at) return "checks";
  return "done";
}

export function toWatch(row: UserSessionRow | null, pendingForAi = 0): TelegramWatch | null {
  if (!row) return null;
  if (!row.session_enc && row.auth_dead) return null;
  return {
    watching: Boolean(row.watching) && Boolean(row.session_enc) && !row.auth_dead,
    lastSyncAt: iso(row.last_sync_at),
    lastSyncOkAt: iso(row.last_sync_ok_at ?? null),
    lastError: row.last_error,
    chatsWatched: Number(row.chats_watched) || 0,
    messagesIngested: Number(row.messages_ingested) || 0,
    pendingForAi,
    openRouterReady: Boolean(row.openrouter_ok_at),
    automationArmed: Boolean(row.automation_armed),
    phoneHint: maskPhone(row.phone),
    needsPassword: Boolean(row.needs_password),
    hasSession: Boolean(row.session_enc) && !row.phone_code_hash_enc && !row.needs_password && !row.auth_dead,
    floodUntil: iso(row.flood_until ?? null),
    authDead: Boolean(row.auth_dead),
    generation: Number(row.account_generation) || 1,
  };
}

const SESSION_COLS = `user_id, api_id, api_hash_enc, phone, phone_code_hash_enc, session_enc,
            needs_password, watching, last_sync_at, last_sync_ok_at, last_error, chats_watched,
            messages_ingested, openrouter_key_enc, openrouter_ok_at, automation_armed,
            checks_json, onboarded_at, flood_until, auth_dead, lease_owner, account_generation`;

export async function getUserSession(userId: string): Promise<UserSessionRow | null> {
  const sql = await getSql();
  try {
    const rows = await sql.query<UserSessionRow>(
      `select ${SESSION_COLS} from telegram_user_sessions where user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  } catch {
    const rows = await sql.query<UserSessionRow>(
      `select user_id, api_id, api_hash_enc, phone, phone_code_hash_enc, session_enc,
              needs_password, watching, last_sync_at, last_error, chats_watched,
              messages_ingested, openrouter_key_enc, openrouter_ok_at, automation_armed,
              checks_json, onboarded_at
         from telegram_user_sessions where user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }
}

export function floodSecondsRemaining(row: UserSessionRow | null): number {
  if (!row?.flood_until) return 0;
  const until = new Date(iso(row.flood_until) ?? 0).getTime();
  const left = Math.ceil((until - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

export function assertSessionLive(row: UserSessionRow | null): UserSessionRow {
  if (!row) throw new TelegramError("invalid", "Connect Telegram first.", 404);
  if (row.auth_dead) {
    throw new TelegramError("auth_dead", "Telegram signed this desk out. Connect again.", 401);
  }
  const wait = floodSecondsRemaining(row);
  if (wait > 0) {
    throw new TelegramError(
      "flood",
      `Telegram asked us to wait ${wait} second${wait === 1 ? "" : "s"}.`,
      429,
      wait,
    );
  }
  return row;
}

export async function markFlood(userId: string, seconds: number, disableWatch = false): Promise<void> {
  const wait = Math.max(1, Math.min(Math.floor(seconds), 86_400));
  const sql = await getSql();
  try {
    await sql.query(
      `update telegram_user_sessions
          set flood_until = greatest(coalesce(flood_until, now()), now() + ($2 || ' seconds')::interval),
              watching = case when $3 then false else watching end,
              last_error = $4,
              updated_at = now()
        where user_id = $1`,
      [userId, String(wait), disableWatch || wait >= 300, `Telegram asked us to wait ${wait} seconds.`],
    );
  } catch {
    /* column may not exist yet */
  }
}

export async function markAuthDead(userId: string, message: string): Promise<void> {
  const sql = await getSql();
  try {
    await sql.query(
      `update telegram_user_sessions
          set auth_dead = true, watching = false, last_error = $2, updated_at = now()
        where user_id = $1`,
      [userId, message.slice(0, 180)],
    );
  } catch {
    await sql.query(
      `update telegram_user_sessions
          set watching = false, last_error = $2, updated_at = now()
        where user_id = $1`,
      [userId, message.slice(0, 180)],
    );
  }
}

export async function persistMappedError(userId: string, err: unknown): Promise<void> {
  if (!(err instanceof TelegramError)) return;
  if (err.code === "auth_dead" || err.code === "unlinked") {
    await markAuthDead(userId, err.message);
    return;
  }
  if (err.code === "peer_flood") {
    await markFlood(userId, err.floodSeconds ?? 3600, true);
    return;
  }
  if (err.code === "flood") {
    await markFlood(userId, err.floodSeconds ?? 30, (err.floodSeconds ?? 0) >= 300);
  }
}

export async function pendingForAiCount(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from telegram_messages where user_id = $1 and ai_status = 'queued'`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

export async function upsertLoginStart(opts: {
  userId: string;
  apiId: number;
  apiHash: string;
  phone: string;
  phoneCodeHash: string;
  session: string;
}): Promise<UserSessionRow> {
  const sql = await getSql();
  await sql.query(
    `insert into telegram_user_sessions (
        user_id, api_id, api_hash_enc, phone, phone_code_hash_enc, session_enc,
        needs_password, watching, checks_json, updated_at
      ) values ($1,$2,$3,$4,$5,$6, false, false, $7, now())
      on conflict (user_id) do update set
        api_id = excluded.api_id,
        api_hash_enc = excluded.api_hash_enc,
        phone = excluded.phone,
        phone_code_hash_enc = excluded.phone_code_hash_enc,
        session_enc = excluded.session_enc,
        needs_password = false,
        watching = false,
        auth_dead = false,
        flood_until = null,
        last_error = null,
        updated_at = now()`,
    [
      opts.userId,
      opts.apiId,
      encryptSecret(opts.apiHash),
      opts.phone,
      encryptSecret(opts.phoneCodeHash),
      encryptSecret(opts.session),
      JSON.stringify(emptyCheckResults()),
    ],
  );
  const row = await getUserSession(opts.userId);
  if (!row) throw new TelegramError("invalid", "Could not save Telegram login.", 500);
  return row;
}

export async function saveSignedIn(opts: {
  userId: string;
  session: string;
  generation?: number;
}): Promise<UserSessionRow> {
  const sql = await getSql();
  const rows = await sql.query<{ user_id: string }>(
    `update telegram_user_sessions
        set session_enc = $2, phone_code_hash_enc = null, needs_password = false,
            last_error = null, auth_dead = false, updated_at = now()
      where user_id = $1
        and ($3::int is null or coalesce(account_generation, 1) = $3)
      returning user_id`,
    [opts.userId, encryptSecret(opts.session), opts.generation ?? null],
  );
  if (!rows[0]) throw new TelegramError("unlinked", "Telegram signed this desk out. Connect again.", 401);
  const row = await getUserSession(opts.userId);
  if (!row) throw new TelegramError("invalid", "Connect Telegram first.", 404);
  return row;
}

export async function markNeedsPassword(userId: string, session: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update telegram_user_sessions
        set needs_password = true, session_enc = $2, last_error = null, updated_at = now()
      where user_id = $1`,
    [userId, encryptSecret(session)],
  );
}

export async function setWatching(userId: string, watching: boolean): Promise<UserSessionRow> {
  const live = assertSessionLive(await getUserSession(userId));
  const sql = await getSql();
  await sql.query(
    `update telegram_user_sessions set watching = $2, updated_at = now()
      where user_id = $1 and coalesce(auth_dead, false) = false
        and coalesce(account_generation, 1) = $3`,
    [userId, watching, Number(live.account_generation) || 1],
  );
  const next = await getUserSession(userId);
  if (!next) throw new TelegramError("invalid", "Connect Telegram first.", 404);
  return next;
}

export async function setAutomationArmed(userId: string, armed: boolean): Promise<UserSessionRow> {
  const live = assertSessionLive(await getUserSession(userId));
  const sql = await getSql();
  await sql.query(
    `update telegram_user_sessions set automation_armed = $2, updated_at = now()
      where user_id = $1 and coalesce(account_generation, 1) = $3`,
    [userId, armed, Number(live.account_generation) || 1],
  );
  if (!armed) {
    await sql.query(
      `update telegram_messages set ai_status = 'held'
        where user_id = $1 and ai_status = 'queued'`,
      [userId],
    );
  }
  const next = await getUserSession(userId);
  if (!next) throw new TelegramError("invalid", "Connect Telegram first.", 404);
  return next;
}

export async function recordSync(opts: {
  userId: string;
  chatsWatched: number;
  messagesIngested: number;
  error?: string | null;
  generation?: number;
}): Promise<void> {
  const sql = await getSql();
  const ok = !opts.error;
  try {
    await sql.query(
      `update telegram_user_sessions
          set last_sync_at = now(),
              last_sync_ok_at = case when $5 then now() else last_sync_ok_at end,
              last_error = $2, chats_watched = $3,
              messages_ingested = $4, updated_at = now()
        where user_id = $1
          and ($6::int is null or coalesce(account_generation, 1) = $6)`,
      [
        opts.userId,
        opts.error ?? null,
        opts.chatsWatched,
        opts.messagesIngested,
        ok,
        opts.generation ?? null,
      ],
    );
  } catch {
    await sql.query(
      `update telegram_user_sessions
          set last_sync_at = now(), last_error = $2, chats_watched = $3,
              messages_ingested = $4, updated_at = now()
        where user_id = $1`,
      [opts.userId, opts.error ?? null, opts.chatsWatched, opts.messagesIngested],
    );
  }
}

export async function saveChecks(userId: string, checks: TelegramCheckResult[]): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update telegram_user_sessions set checks_json = $2, updated_at = now() where user_id = $1`,
    [userId, JSON.stringify(checks)],
  );
}

export async function finishUserOnboarding(userId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update telegram_user_sessions set onboarded_at = now(), updated_at = now()
      where user_id = $1 and coalesce(auth_dead, false) = false`,
    [userId],
  );
}

export async function markOpenRouterReady(userId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update telegram_user_sessions
        set openrouter_ok_at = now(), last_error = null, updated_at = now()
      where user_id = $1`,
    [userId],
  );
}

export async function saveOpenRouterKey(userId: string, key: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update telegram_user_sessions
        set openrouter_key_enc = $2, openrouter_ok_at = now(), last_error = null, updated_at = now()
      where user_id = $1`,
    [userId, encryptSecret(key)],
  );
}

export async function decryptSessionMaterial(row: UserSessionRow): Promise<{
  apiId: number;
  apiHash: string;
  session: string;
  phone: string;
  phoneCodeHash: string | null;
}> {
  return {
    apiId: Number(row.api_id),
    apiHash: decryptSecret(row.api_hash_enc),
    session: row.session_enc ? decryptSecret(row.session_enc) : "",
    phone: row.phone,
    phoneCodeHash: row.phone_code_hash_enc ? decryptSecret(row.phone_code_hash_enc) : null,
  };
}

export async function decryptOpenRouterKey(row: UserSessionRow): Promise<string | null> {
  if (!row.openrouter_key_enc) return null;
  try {
    return decryptSecret(row.openrouter_key_enc);
  } catch {
    return null;
  }
}

export async function invalidateUserSession(userId: string): Promise<void> {
  const sql = await getSql();
  try {
    await seizeSessionGeneration(sql, userId);
  } catch {
    /* generation / lease columns may not exist yet */
  }
}

export async function wipeUserSession(userId: string): Promise<void> {
  const sql = await getSql();
  const checks = JSON.stringify(emptyCheckResults());
  try {
    const wiped = await wipeDisconnectedSession(sql, userId, checks);
    if (wiped) return;
  } catch {
    try {
      const wiped = await wipeDisconnectedSession(sql, userId);
      if (wiped) return;
    } catch {
      /* fall through to delete */
    }
  }
  await sql.query(`delete from telegram_user_sessions where user_id = $1`, [userId]);
}

export async function deleteUserSession(userId: string): Promise<void> {
  await invalidateUserSession(userId);
  await wipeUserSession(userId);
}

export function sessionChecks(row: UserSessionRow | null): TelegramCheckResult[] {
  return parseChecksJson(row?.checks_json);
}
