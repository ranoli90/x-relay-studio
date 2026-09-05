import { getSql } from "@/lib/db";
import { decryptSecret, encryptSecret, SecretOpenError } from "@/lib/secrets";
import type { HealthReport, RedditAccountPublic, RedditAppPublic } from "./types";

type AppRow = {
  user_id: string;
  client_id: string;
  client_secret: string;
  user_agent_name: string;
  redirect_uri: string;
  app_label: string | null;
  app_id: string | null;
  terms_at: string | Date | null;
  credential_version?: number | null;
};

type AccountRow = {
  id: string;
  user_id: string;
  reddit_id: string;
  name: string;
  icon_img: string | null;
  created_utc: number | null;
  has_verified_email: boolean;
  is_gold: boolean;
  is_mod: boolean;
  is_suspended: boolean;
  link_karma: number;
  comment_karma: number;
  total_karma: number;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | Date | null;
  scopes: string;
  health_json: string | null;
  health_ok: boolean;
  onboarded_at: string | Date | null;
};

type TicketRow = {
  ticket: string;
  user_id: string;
  state: string;
  redirect_uri: string;
  expires_at: string | Date;
};

function seal(value: string): string {
  return encryptSecret(value);
}

function open(value: string | null | undefined): string {
  if (!value) return "";
  return decryptSecret(value);
}

function decodeApp(row: AppRow): AppRow {
  return { ...row, client_secret: open(row.client_secret) };
}

function decodeAccount(row: AccountRow): AccountRow {
  return {
    ...row,
    refresh_token: open(row.refresh_token),
    access_token: row.access_token ? open(row.access_token) : row.access_token,
  };
}

function parseHealth(raw: string | null): HealthReport | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HealthReport;
  } catch {
    return null;
  }
}

function asIso(v: string | Date | null | undefined) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function toPublicAccount(row: AccountRow): RedditAccountPublic {
  return {
    id: row.id,
    redditId: row.reddit_id,
    name: row.name,
    iconImg: row.icon_img,
    createdUtc: row.created_utc == null ? null : Number(row.created_utc),
    hasVerifiedEmail: Boolean(row.has_verified_email),
    isGold: Boolean(row.is_gold),
    isMod: Boolean(row.is_mod),
    isSuspended: Boolean(row.is_suspended),
    linkKarma: Number(row.link_karma ?? 0),
    commentKarma: Number(row.comment_karma ?? 0),
    totalKarma: Number(row.total_karma ?? 0),
    healthOk: Boolean(row.health_ok),
    health: parseHealth(row.health_json),
    onboardedAt: asIso(row.onboarded_at),
  };
}

export async function getApp(userId: string) {
  const sql = await getSql();
  const rows = await sql<AppRow>`
    select * from reddit_apps where user_id = ${userId} limit 1
  `;
  return rows[0] ? decodeApp(rows[0]) : null;
}

export function toPublicApp(
  app: AppRow | null,
  redirectUri: string,
): RedditAppPublic {
  if (!app) return { configured: false, redirectUri };
  return {
    configured: true,
    clientId: app.client_id,
    userAgentName: app.user_agent_name,
    appLabel: app.app_label ?? undefined,
    appId: app.app_id ?? undefined,
    redirectUri: app.redirect_uri || redirectUri,
  };
}

export async function upsertApp(opts: {
  userId: string;
  clientId: string;
  clientSecret: string;
  userAgentName: string;
  redirectUri: string;
  appLabel: string;
  appId: string;
  termsAt?: Date | null;
}) {
  const sql = await getSql();
  const terms = (opts.termsAt ?? new Date()).toISOString();
  const sealedSecret = seal(opts.clientSecret);
  await sql`
    insert into reddit_apps (
      user_id, client_id, client_secret, user_agent_name, redirect_uri,
      app_label, app_id, terms_at, updated_at
    )
    values (
      ${opts.userId}, ${opts.clientId}, ${sealedSecret}, ${opts.userAgentName},
      ${opts.redirectUri}, ${opts.appLabel}, ${opts.appId}, ${terms}, now()
    )
    on conflict (user_id) do update set
      client_id = excluded.client_id,
      client_secret = excluded.client_secret,
      user_agent_name = excluded.user_agent_name,
      redirect_uri = excluded.redirect_uri,
      app_label = excluded.app_label,
      app_id = excluded.app_id,
      terms_at = excluded.terms_at,
      updated_at = now()
  `;
}

export async function listAccounts(userId: string) {
  const sql = await getSql();
  const rows = await sql<AccountRow>`
    select * from reddit_accounts
    where user_id = ${userId}
      and disabled_at is null
    order by created_at asc
  `;
  return rows.map(decodeAccount);
}

export async function countAccounts(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from reddit_accounts
    where user_id = ${userId} and disabled_at is null
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function getAccount(userId: string, accountId: string) {
  const sql = await getSql();
  const rows = await sql<AccountRow>`
    select * from reddit_accounts
    where user_id = ${userId} and id = ${accountId}
    limit 1
  `;
  return rows[0] ? decodeAccount(rows[0]) : null;
}

export async function getAccountByRedditId(userId: string, redditId: string) {
  const sql = await getSql();
  const rows = await sql<AccountRow>`
    select * from reddit_accounts
    where user_id = ${userId} and reddit_id = ${redditId}
    limit 1
  `;
  return rows[0] ? decodeAccount(rows[0]) : null;
}

export async function redditIdTakenByOther(redditId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from reddit_accounts
    where reddit_id = ${redditId} and user_id <> ${userId}
    limit 1
  `;
  return rows.length > 0;
}

export async function upsertAccount(opts: {
  id: string;
  userId: string;
  redditId: string;
  name: string;
  iconImg: string | null;
  createdUtc: number | null;
  hasVerifiedEmail: boolean;
  isGold: boolean;
  isMod: boolean;
  isSuspended: boolean;
  linkKarma: number;
  commentKarma: number;
  totalKarma: number;
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: Date;
  scopes: string;
  health: HealthReport;
}) {
  const sql = await getSql();
  const healthJson = JSON.stringify(opts.health);
  const sealedRefresh = seal(opts.refreshToken);
  const sealedAccess = seal(opts.accessToken);
  await sql`
    insert into reddit_accounts (
      id, user_id, reddit_id, name, icon_img, created_utc, has_verified_email,
      is_gold, is_mod, is_suspended, link_karma, comment_karma, total_karma,
      refresh_token, access_token, access_expires_at, scopes, health_json, health_ok, updated_at
    ) values (
      ${opts.id}, ${opts.userId}, ${opts.redditId}, ${opts.name}, ${opts.iconImg},
      ${opts.createdUtc}, ${opts.hasVerifiedEmail}, ${opts.isGold}, ${opts.isMod},
      ${opts.isSuspended}, ${opts.linkKarma}, ${opts.commentKarma}, ${opts.totalKarma},
      ${sealedRefresh}, ${sealedAccess}, ${opts.accessExpiresAt.toISOString()},
      ${opts.scopes}, ${healthJson}, ${opts.health.okToUse}, now()
    )
    on conflict (user_id, reddit_id) do update set
      name = excluded.name,
      icon_img = excluded.icon_img,
      created_utc = excluded.created_utc,
      has_verified_email = excluded.has_verified_email,
      is_gold = excluded.is_gold,
      is_mod = excluded.is_mod,
      is_suspended = excluded.is_suspended,
      link_karma = excluded.link_karma,
      comment_karma = excluded.comment_karma,
      total_karma = excluded.total_karma,
      refresh_token = excluded.refresh_token,
      access_token = excluded.access_token,
      access_expires_at = excluded.access_expires_at,
      scopes = excluded.scopes,
      health_json = excluded.health_json,
      health_ok = excluded.health_ok,
      updated_at = now()
  `;
}

export async function saveTokens(opts: {
  userId: string;
  accountId: string;
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string;
}) {
  const sql = await getSql();
  const sealedAccess = seal(opts.accessToken);
  if (opts.refreshToken) {
    const sealedRefresh = seal(opts.refreshToken);
    await sql`
      update reddit_accounts
      set access_token = ${sealedAccess},
          access_expires_at = ${opts.expiresAt.toISOString()},
          refresh_token = ${sealedRefresh},
          updated_at = now()
      where user_id = ${opts.userId} and id = ${opts.accountId}
    `;
  } else {
    await sql`
      update reddit_accounts
      set access_token = ${sealedAccess},
          access_expires_at = ${opts.expiresAt.toISOString()},
          updated_at = now()
      where user_id = ${opts.userId} and id = ${opts.accountId}
    `;
  }
}

export async function saveHealth(opts: {
  userId: string;
  accountId: string;
  health: HealthReport;
  me?: {
    iconImg?: string | null;
    hasVerifiedEmail?: boolean;
    isGold?: boolean;
    isMod?: boolean;
    isSuspended?: boolean;
    linkKarma?: number;
    commentKarma?: number;
    totalKarma?: number;
  };
}) {
  const sql = await getSql();
  const healthJson = JSON.stringify(opts.health);
  await sql`
    update reddit_accounts set
      health_json = ${healthJson},
      health_ok = ${opts.health.okToUse},
      icon_img = coalesce(${opts.me?.iconImg ?? null}, icon_img),
      has_verified_email = coalesce(${opts.me?.hasVerifiedEmail ?? null}, has_verified_email),
      is_gold = coalesce(${opts.me?.isGold ?? null}, is_gold),
      is_mod = coalesce(${opts.me?.isMod ?? null}, is_mod),
      is_suspended = coalesce(${opts.me?.isSuspended ?? null}, is_suspended),
      link_karma = coalesce(${opts.me?.linkKarma ?? null}, link_karma),
      comment_karma = coalesce(${opts.me?.commentKarma ?? null}, comment_karma),
      total_karma = coalesce(${opts.me?.totalKarma ?? null}, total_karma),
      updated_at = now()
    where user_id = ${opts.userId} and id = ${opts.accountId}
  `;
}

export async function markOnboarded(userId: string, accountId: string) {
  const sql = await getSql();
  await sql`
    update reddit_accounts
    set onboarded_at = now(), updated_at = now()
    where user_id = ${userId} and id = ${accountId} and onboarded_at is null
  `;
}

export async function deleteAccount(userId: string, accountId: string) {
  const sql = await getSql();
  const rows = await sql<AccountRow>`
    delete from reddit_accounts
    where user_id = ${userId} and id = ${accountId}
    returning *
  `;
  return rows[0] ? decodeAccount(rows[0]) : null;
}

export async function disableAccount(userId: string, accountId: string) {
  const sql = await getSql();
  const rows = await sql<AccountRow>`
    update reddit_accounts
       set disabled_at = coalesce(disabled_at, now()),
           disconnected_at = coalesce(disconnected_at, now()),
           connection_state = 'disabled',
           cleanup_pending = true,
           health_ok = false,
           updated_at = now()
     where user_id = ${userId} and id = ${accountId}
     returning *
  `;
  return rows[0] ? decodeAccount(rows[0]) : null;
}

export async function insertTicket(opts: {
  ticket: string;
  userId: string;
  state: string;
  redirectUri: string;
  expiresAt: Date;
}) {
  const sql = await getSql();
  await sql`
    insert into reddit_oauth_tickets (ticket, user_id, state, redirect_uri, expires_at)
    values (${opts.ticket}, ${opts.userId}, ${opts.state}, ${opts.redirectUri}, ${opts.expiresAt.toISOString()})
  `;
}

export async function getTicket(ticket: string) {
  const sql = await getSql();
  const rows = await sql<TicketRow>`
    select ticket, user_id, state, redirect_uri, expires_at
    from reddit_oauth_tickets
    where ticket = ${ticket}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function takeTicketByState(state: string) {
  const sql = await getSql();
  const rows = await sql<TicketRow>`
    delete from reddit_oauth_tickets
    where state = ${state}
    returning ticket, user_id, state, redirect_uri, expires_at
  `;
  return rows[0] ?? null;
}

export async function purgeExpiredTickets() {
  const sql = await getSql();
  await sql`delete from reddit_oauth_tickets where expires_at < now()`;
}

export function expiresAtToDate(v: string | Date | null | undefined) {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}
