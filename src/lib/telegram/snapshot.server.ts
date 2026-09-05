import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { TelegramError } from "./errors";
import { BIO_GRAPHEME_LIMIT, STUDIO_NOTES_CHAT_ID } from "./types";
import type { TelegramAccount, TelegramChat, TelegramMessage, TelegramPath } from "./types";
import { graphemeCount, sliceGraphemes } from "./graphemes";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function previewTelegramId(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const mag = Math.abs(h) % 1_000_000_000;
  return 900_000_000_000_000 + mag;
}

type AccountRow = {
  telegram_user_id: number | string;
  username: string | null;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  auth_date: string | Date | null;
  path: TelegramPath;
  bot_can_write: boolean;
  preview: boolean;
  replica_first_name: string | null;
  replica_last_name: string | null;
  replica_about: string | null;
};

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function mapAccount(row: AccountRow): TelegramAccount {
  const replicaFirst = row.replica_first_name?.trim() || null;
  const replicaLast = row.replica_last_name?.trim() || null;
  const firstName = replicaFirst || row.first_name;
  const lastName = replicaLast ?? row.last_name;
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || "Telegram";
  return {
    telegramUserId: Number(row.telegram_user_id),
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    photoUrl: row.photo_url,
    authDate: iso(row.auth_date),
    path: row.path,
    botCanWrite: row.bot_can_write,
    preview: row.preview,
    replicaFirstName: replicaFirst,
    replicaLastName: replicaLast,
    replicaAbout: row.replica_about,
    displayFirstName: firstName,
    displayLastName: lastName,
    displayName,
  };
}

export async function takeRate(
  userId: string,
  kind: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const sql = await getSql();
  const since = new Date(Date.now() - windowMs).toISOString();
  await sql.query(`delete from telegram_rate_events where at < $1`, [
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  ]);
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from telegram_rate_events where user_id = $1 and kind = $2 and at >= $3`,
    [userId, kind, since],
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    throw new TelegramError("flood", "Telegram asked us to wait.", 429);
  }
  await sql.query(`insert into telegram_rate_events (user_id, kind) values ($1, $2)`, [userId, kind]);
}

export async function getAccount(userId: string): Promise<TelegramAccount | null> {
  const sql = await getSql();
  const rows = await sql.query<AccountRow>(
    `select telegram_user_id, username, first_name, last_name, photo_url, auth_date, path,
            bot_can_write, preview, replica_first_name, replica_last_name, replica_about
       from telegram_accounts where user_id = $1`,
    [userId],
  );
  return rows[0] ? mapAccount(rows[0]) : null;
}

export async function seedStudioNotes(userId: string, displayName: string): Promise<void> {
  const sql = await getSql();
  const existing = await sql.query<{ id: string }>(
    `select id from telegram_chats where user_id = $1 and id = $2`,
    [userId, STUDIO_NOTES_CHAT_ID],
  );
  const body = `You’re connected as ${displayName}. Telegram only shared your identity with this app. Private chats with other people stay in Telegram.`;
  const now = new Date().toISOString();
  if (!existing[0]) {
    await sql.query(
      `insert into telegram_chats (id, user_id, kind, title, last_preview, last_at, pinned)
       values ($1, $2, 'notes', 'Studio', $3, $4, true)`,
      [STUDIO_NOTES_CHAT_ID, userId, body.slice(0, 140), now],
    );
    await sql.query(
      `insert into telegram_messages (id, user_id, chat_id, from_self, author_name, body, created_at)
       values ($1, $2, $3, false, 'Studio', $4, $5)`,
      [newId("msg"), userId, STUDIO_NOTES_CHAT_ID, body, now],
    );
  }
}

export async function upsertLinkedAccount(opts: {
  userId: string;
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  botCanWrite: boolean;
  path: TelegramPath;
  preview: boolean;
}): Promise<TelegramAccount> {
  const sql = await getSql();
  const taken = await sql.query<{ user_id: string }>(
    `select user_id from telegram_accounts where telegram_user_id = $1`,
    [opts.telegramUserId],
  );
  if (taken[0] && taken[0].user_id !== opts.userId) {
    throw new TelegramError("telegram_in_use", "That Telegram account is already linked here.", 409);
  }

  await sql.query(
    `insert into telegram_accounts (
        user_id, telegram_user_id, username, first_name, last_name, photo_url, auth_date,
        path, bot_can_write, preview, updated_at, last_seen_at
      ) values ($1,$2,$3,$4,$5,$6, now(), $7, $8, $9, now(), now())
      on conflict (user_id) do update set
        telegram_user_id = excluded.telegram_user_id,
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        photo_url = excluded.photo_url,
        auth_date = excluded.auth_date,
        path = excluded.path,
        bot_can_write = excluded.bot_can_write,
        preview = excluded.preview,
        updated_at = now(),
        last_seen_at = now()`,
    [
      opts.userId,
      opts.telegramUserId,
      opts.username,
      opts.firstName,
      opts.lastName,
      opts.photoUrl,
      opts.path,
      opts.botCanWrite,
      opts.preview,
    ],
  );

  const account = await getAccount(opts.userId);
  if (!account) throw new TelegramError("invalid", "Could not save Telegram account.", 500);
  await seedStudioNotes(opts.userId, account.displayName);
  console.info("[telegram]", {
    event: "linked",
    userId: opts.userId,
    telegramUserId: opts.telegramUserId,
    path: opts.path,
    preview: opts.preview,
  });
  return account;
}

export async function enterPreviewAccount(
  userId: string,
  displayName: string,
): Promise<TelegramAccount> {
  const first = displayName.trim().split(/\s+/)[0] || "You";
  const rest = displayName.trim().split(/\s+/).slice(1).join(" ") || null;
  return upsertLinkedAccount({
    userId,
    telegramUserId: previewTelegramId(userId),
    firstName: first,
    lastName: rest,
    username: null,
    photoUrl: null,
    botCanWrite: false,
    path: "oidc",
    preview: true,
  });
}

export async function listChats(userId: string): Promise<TelegramChat[]> {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    kind: TelegramChat["kind"];
    title: string;
    photo_url: string | null;
    last_preview: string | null;
    last_at: string | Date | null;
    unread: number;
    pinned: boolean;
    muted: boolean;
  }>(
    `select id, kind, title, photo_url, last_preview, last_at, unread, pinned, muted
       from telegram_chats where user_id = $1
       order by pinned desc, last_at desc, title asc`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    photoUrl: row.photo_url,
    lastPreview: row.last_preview,
    lastAt: iso(row.last_at),
    unread: row.unread,
    pinned: row.pinned,
    muted: row.muted,
  }));
}

export async function listMessages(
  userId: string,
  chatId: string,
): Promise<TelegramMessage[]> {
  const sql = await getSql();
  const owned = await sql.query<{ id: string }>(
    `select id from telegram_chats where user_id = $1 and id = $2`,
    [userId, chatId],
  );
  if (!owned[0]) return [];
  const rows = await sql.query<{
    id: string;
    chat_id: string;
    from_self: boolean;
    author_name: string;
    body: string;
    created_at: string | Date;
  }>(
    `select id, chat_id, from_self, author_name, body, created_at
       from telegram_messages where user_id = $1 and chat_id = $2
       order by created_at asc`,
    [userId, chatId],
  );
  return rows.map((row) => ({
    id: row.id,
    chatId: row.chat_id,
    fromSelf: row.from_self,
    authorName: row.author_name,
    body: row.body,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  }));
}

export async function sendNote(
  userId: string,
  chatId: string,
  body: string,
  authorName: string,
): Promise<TelegramMessage> {
  const text = body.trim();
  if (!text) throw new TelegramError("invalid", "Message is empty.", 400);
  if (text.length > 4000) throw new TelegramError("invalid", "Message is too long.", 400);
  const sql = await getSql();
  const chat = await sql.query<{ id: string; kind: string }>(
    `select id, kind from telegram_chats where user_id = $1 and id = $2`,
    [userId, chatId],
  );
  if (!chat[0]) throw new TelegramError("invalid", "Chat not found.", 404);
  if (chat[0].kind !== "notes") {
    throw new TelegramError("invalid", "This path can only write Studio notes.", 400);
  }
  const now = new Date().toISOString();
  const id = newId("msg");
  await sql.query(
    `insert into telegram_messages (id, user_id, chat_id, from_self, author_name, body, created_at)
     values ($1,$2,$3,true,$4,$5,$6)`,
    [id, userId, chatId, authorName, text, now],
  );
  await sql.query(
    `update telegram_chats set last_preview = $1, last_at = $2 where user_id = $3 and id = $4`,
    [text.slice(0, 140), now, userId, chatId],
  );
  return {
    id,
    chatId,
    fromSelf: true,
    authorName,
    body: text,
    createdAt: now,
  };
}

export async function updateReplicaProfile(
  userId: string,
  input: { firstName: string; lastName: string; about: string },
): Promise<TelegramAccount> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const about = sliceGraphemes(input.about.trim(), BIO_GRAPHEME_LIMIT);
  if (!firstName) throw new TelegramError("invalid", "First name is required.", 400);
  if (firstName.length > 64 || lastName.length > 64) {
    throw new TelegramError("invalid", "Name is too long.", 400);
  }
  if (graphemeCount(about) > BIO_GRAPHEME_LIMIT) {
    throw new TelegramError("invalid", "Bio is too long.", 400);
  }
  const sql = await getSql();
  const updated = await sql.query<{ user_id: string }>(
    `update telegram_accounts
        set replica_first_name = $2,
            replica_last_name = $3,
            replica_about = $4,
            updated_at = now()
      where user_id = $1
      returning user_id`,
    [userId, firstName, lastName || null, about || null],
  );
  if (!updated[0]) throw new TelegramError("unlinked", "Connect Telegram first.", 404);
  const account = await getAccount(userId);
  if (!account) throw new TelegramError("unlinked", "Connect Telegram first.", 404);
  return account;
}

export async function unlinkAccount(userId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from telegram_accounts where user_id = $1`, [userId]);
  console.info("[telegram]", { event: "unlinked", userId });
}

export async function createOidcTicket(opts: {
  userId: string;
  state: string;
  nonce: string;
  verifier: string;
}): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from telegram_oidc_tickets where created_at < $1`, [
    new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  ]);
  await sql.query(
    `insert into telegram_oidc_tickets (state, user_id, nonce, verifier) values ($1,$2,$3,$4)`,
    [opts.state, opts.userId, opts.nonce, opts.verifier],
  );
}

export async function consumeOidcTicket(state: string): Promise<{
  userId: string;
  nonce: string;
  verifier: string;
} | null> {
  const sql = await getSql();
  const rows = await sql.query<{
    user_id: string;
    nonce: string;
    verifier: string;
    used_at: string | Date | null;
    created_at: string | Date;
  }>(
    `select user_id, nonce, verifier, used_at, created_at from telegram_oidc_tickets where state = $1`,
    [state],
  );
  const row = rows[0];
  if (!row || row.used_at) return null;
  const created = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  if (Date.now() - created.getTime() > 10 * 60 * 1000) return null;
  await sql.query(`update telegram_oidc_tickets set used_at = now() where state = $1`, [state]);
  return { userId: row.user_id, nonce: row.nonce, verifier: row.verifier };
}
