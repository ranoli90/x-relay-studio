/** MTProto row-lease SQL. Stale owners cannot clear or renew a newer lease. */

export const LEASE_SECONDS = 25;
export const LEASE_RENEW_EVERY_MS = 10_000;

export type LeaseSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type ClaimedLease = {
  userId: string;
  owner: string;
  generation: number;
};

export async function claimMtprotoLease(
  sql: LeaseSql,
  userId: string,
  owner: string,
  seconds = LEASE_SECONDS,
): Promise<ClaimedLease | null> {
  const claimed = await sql.query<{ user_id: string; account_generation: number | null }>(
    `update telegram_user_sessions
        set lease_until = now() + ($2::int * interval '1 second'),
            lease_owner = $3,
            updated_at = now()
      where user_id = $1
        and (lease_until is null or lease_until <= now())
      returning user_id, account_generation`,
    [userId, seconds, owner],
  );
  const row = claimed[0];
  if (!row) return null;
  return { userId: row.user_id, owner, generation: Number(row.account_generation) || 1 };
}

export async function renewMtprotoLease(
  sql: LeaseSql,
  userId: string,
  owner: string,
  generation: number,
  seconds = LEASE_SECONDS,
): Promise<boolean> {
  const rows = await sql.query<{ user_id: string }>(
    `update telegram_user_sessions
        set lease_until = now() + ($3::int * interval '1 second'),
            updated_at = now()
      where user_id = $1
        and lease_owner = $2
        and coalesce(account_generation, 1) = $4
      returning user_id`,
    [userId, owner, seconds, generation],
  );
  return Boolean(rows[0]);
}

export async function releaseMtprotoLease(
  sql: LeaseSql,
  userId: string,
  owner: string,
): Promise<boolean> {
  const rows = await sql.query<{ user_id: string }>(
    `update telegram_user_sessions
        set lease_until = null, lease_owner = null, updated_at = now()
      where user_id = $1 and lease_owner = $2
      returning user_id`,
    [userId, owner],
  );
  return Boolean(rows[0]);
}

export async function sessionGeneration(sql: LeaseSql, userId: string): Promise<number | null> {
  const rows = await sql.query<{ account_generation: number | null }>(
    `select account_generation from telegram_user_sessions where user_id = $1`,
    [userId],
  );
  if (!rows[0]) return null;
  return Number(rows[0].account_generation) || 1;
}

/** Bump generation and drop the live lease/watch so in-flight workers cannot write. */
export async function seizeSessionGeneration(sql: LeaseSql, userId: string): Promise<number | null> {
  const rows = await sql.query<{ account_generation: number | null }>(
    `update telegram_user_sessions
        set account_generation = coalesce(account_generation, 1) + 1,
            watching = false,
            automation_armed = false,
            lease_until = null,
            lease_owner = null,
            updated_at = now()
      where user_id = $1
      returning account_generation`,
    [userId],
  );
  if (!rows[0]) return null;
  return Number(rows[0].account_generation) || 1;
}

/** Clear session material after a generation seize. Does not bump generation again. */
export async function wipeDisconnectedSession(
  sql: LeaseSql,
  userId: string,
  checksJson?: string,
): Promise<boolean> {
  const checks = checksJson ?? "[]";
  try {
    const rows = await sql.query<{ user_id: string }>(
      `update telegram_user_sessions
          set session_enc = null,
              phone_code_hash_enc = null,
              api_hash_enc = '',
              phone = '',
              watching = false,
              automation_armed = false,
              auth_dead = true,
              flood_until = null,
              lease_until = null,
              lease_owner = null,
              onboarded_at = null,
              last_error = null,
              last_sync_at = null,
              last_sync_ok_at = null,
              checks_json = $2,
              updated_at = now()
        where user_id = $1
        returning user_id`,
      [userId, checks],
    );
    return Boolean(rows[0]);
  } catch {
    const rows = await sql.query<{ user_id: string }>(
      `update telegram_user_sessions
          set session_enc = null,
              phone_code_hash_enc = null,
              api_hash_enc = '',
              phone = '',
              watching = false,
              lease_until = null,
              lease_owner = null,
              onboarded_at = null,
              last_error = null,
              updated_at = now()
        where user_id = $1
        returning user_id`,
      [userId],
    );
    return Boolean(rows[0]);
  }
}

export async function disconnectMtprotoSession(
  sql: LeaseSql,
  userId: string,
  checksJson?: string,
): Promise<number | null> {
  const generation = await seizeSessionGeneration(sql, userId);
  if (generation == null) return null;
  await wipeDisconnectedSession(sql, userId, checksJson);
  return generation;
}
