import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { helperChatId, notesChatId } from "./bot-token";
import { TelegramError } from "./errors";
import type {
  TelegramAccount,
  TelegramChat,
  TelegramMessage,
  TelegramMessageStatus,
  TelegramPath,
  TelegramAiStatus,
} from "./types";
import { assertBioLimit, clampBio, safeHttpUrl, sanitizeUsername } from "./validate";
import { redactPreview } from "./preview";

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
  replica_username: string | null;
};

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function mapAccount(row: AccountRow): TelegramAccount {
  const replicaFirst = row.replica_first_name?.trim() || null;
  const replicaLast = row.replica_last_name?.trim() || null;
  const replicaUsername = row.replica_username?.trim() || null;
  const firstName = replicaFirst || row.first_name;
  const lastName = replicaLast ?? row.last_name;
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || "Telegram";
  const displayUsername = replicaUsername || row.username;
  return {
    telegramUserId: Number(row.telegram_user_id),
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    photoUrl: safeHttpUrl(row.photo_url),
    authDate: iso(row.auth_date),
    path: row.path,
    botCanWrite: row.bot_can_write,
    preview: row.preview,
    replicaFirstName: replicaFirst,
    replicaLastName: replicaLast,
    replicaAbout: row.replica_about,
    replicaUsername,
    displayFirstName: firstName,
    displayLastName: lastName,
    displayUsername,
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
  await sql.query(`insert into telegram_rate_events (user_id, kind) values ($1, $2)`, [userId, kind]);
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from telegram_rate_events where user_id = $1 and kind = $2 and at >= $3`,
    [userId, kind, since],
  );
  if ((rows[0]?.n ?? 0) > limit) {
    const wait = Math.max(1, Math.ceil(windowMs / 1000));
    throw new TelegramError("flood", `Telegram asked us to wait ${wait} seconds.`, 429, wait);
  }
}

const ACCOUNT_COLS = `telegram_user_id, username, first_name, last_name, photo_url, auth_date, path,
            bot_can_write, preview, replica_first_name, replica_last_name, replica_about, replica_username`;

export async function getAccount(userId: string): Promise<TelegramAccount | null> {
  const sql = await getSql();
  const rows = await sql.query<AccountRow>(
    `select ${ACCOUNT_COLS} from telegram_accounts where user_id = $1`,
    [userId],
  );
  return rows[0] ? mapAccount(rows[0]) : null;
}

export async function seedStudioNotes(userId: string, displayName: string): Promise<void> {
  const sql = await getSql();
  const chatId = notesChatId(userId);
  const existing = await sql.query<{ id: string }>(
    `select id from telegram_chats where user_id = $1 and id = $2`,
    [userId, chatId],
  );
  const body = `You’re connected as ${displayName}. This desk watches your real Telegram chats. Automation is not started.`;
  const now = new Date().toISOString();
  if (!existing[0]) {
    await sql.query(
      `insert into telegram_chats (id, user_id, kind, title, last_preview, last_at, pinned)
       values ($1, $2, 'notes', 'Studio', $3, $4, true)`,
      [chatId, userId, body.slice(0, 140), now],
    );
    await sql.query(
      `insert into telegram_messages (id, user_id, chat_id, from_self, author_name, body, created_at, status)
       values ($1, $2, $3, false, 'Studio', $4, $5, 'sent')`,
      [newId("msg"), userId, chatId, body, now],
    );
  }
}

export async function seedHelperChat(
  userId: string,
  botName: string,
  userFirstName: string,
): Promise<void> {
  const sql = await getSql();
  const chatId = helperChatId(userId);
  const existing = await sql.query<{ id: string }>(
    `select id from telegram_chats where user_id = $1 and id = $2`,
    [userId, chatId],
  );
  const body = `${userFirstName} tapped Start. This is the private thread with your helper.`;
  const now = new Date().toISOString();
  if (!existing[0]) {
    await sql.query(
      `insert into telegram_chats (id, user_id, kind, title, last_preview, last_at, pinned)
       values ($1, $2, 'bot', $3, $4, $5, true)`,
      [chatId, userId, botName || "Helper", body.slice(0, 140), now],
    );
    await sql.query(
      `insert into telegram_messages (id, user_id, chat_id, from_self, author_name, body, created_at, status)
       values ($1, $2, $3, false, $4, $5, $6, 'sent')`,
      [newId("msg"), userId, chatId, botName || "Helper", body, now],
    );
  }
}

export async function appendMessage(opts: {
  userId: string;
  chatId: string;
  fromSelf: boolean;
  authorName: string;
  body: string;
  telegramMessageId?: number | null;
  status?: TelegramMessageStatus;
  createdAt?: string;
  bumpUnread?: boolean;
  aiStatus?: TelegramAiStatus;
}): Promise<TelegramMessage> {
  const text = opts.body.trim();
  if (!text) throw new TelegramError("invalid", "Message is empty.", 400);
  if (text.length > 4000) throw new TelegramError("invalid", "Message is too long.", 400);
  const sql = await getSql();
  const chat = await sql.query<{ id: string }>(
    `select id from telegram_chats where user_id = $1 and id = $2`,
    [opts.userId, opts.chatId],
  );
  if (!chat[0]) throw new TelegramError("invalid", "Chat not found.", 404);

  if (opts.telegramMessageId != null) {
    const dup = await sql.query<{
      id: string;
      chat_id: string;
      from_self: boolean;
      author_name: string;
      body: string;
      created_at: string | Date;
      status: string | null;
    }>(
      `select id, chat_id, from_self, author_name, body, created_at, status
         from telegram_messages
        where user_id = $1 and chat_id = $2 and telegram_message_id = $3`,
      [opts.userId, opts.chatId, opts.telegramMessageId],
    );
    if (dup[0]) {
      return {
        id: dup[0].id,
        chatId: dup[0].chat_id,
        fromSelf: dup[0].from_self,
        authorName: dup[0].author_name,
        body: dup[0].body,
        createdAt: iso(dup[0].created_at) ?? new Date().toISOString(),
        status: dup[0].status === "sending" ? "sending" : "sent",
      };
    }
  }

  const now = opts.createdAt ?? new Date().toISOString();
  const id = newId("msg");
  const status: TelegramMessageStatus = opts.status ?? "sent";
  const aiStatus: TelegramAiStatus =
    opts.aiStatus ?? (opts.fromSelf ? "outbound" : "queued");
  await sql.query(
    `insert into telegram_messages (id, user_id, chat_id, from_self, author_name, body, created_at, telegram_message_id, status, ai_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      opts.userId,
      opts.chatId,
      opts.fromSelf,
      opts.authorName,
      text,
      now,
      opts.telegramMessageId ?? null,
      status,
      aiStatus,
    ],
  );
  const bump = opts.bumpUnread !== false && !opts.fromSelf;
  if (opts.fromSelf) {
    await sql.query(
      `update telegram_chats set last_preview = $1, last_at = $2 where user_id = $3 and id = $4`,
      [text.slice(0, 140), now, opts.userId, opts.chatId],
    );
  } else if (bump) {
    await sql.query(
      `update telegram_chats
          set last_preview = $1, last_at = $2, unread = unread + 1
        where user_id = $3 and id = $4`,
      [text.slice(0, 140), now, opts.userId, opts.chatId],
    );
  } else {
    await sql.query(
      `update telegram_chats set last_preview = coalesce($1, last_preview), last_at = coalesce($2, last_at)
        where user_id = $3 and id = $4`,
      [text.slice(0, 140), now, opts.userId, opts.chatId],
    );
  }
  return {
    id,
    chatId: opts.chatId,
    fromSelf: opts.fromSelf,
    authorName: opts.authorName,
    body: text,
    createdAt: now,
    status,
  };
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

  const photoUrl = safeHttpUrl(opts.photoUrl);

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
      photoUrl,
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
    peer_id: string | null;
  }>(
    `select id, kind, title, photo_url, last_preview, last_at, unread, pinned, muted, peer_id
       from telegram_chats where user_id = $1
       order by pinned desc, last_at desc, title asc`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    photoUrl: row.photo_url?.startsWith("/") ? row.photo_url : safeHttpUrl(row.photo_url) || chatPhotoUrl(row.peer_id),
    lastPreview: redactPreview(row.last_preview),
    lastAt: iso(row.last_at),
    unread: row.unread,
    pinned: row.pinned,
    muted: row.muted,
  }));
}

export async function markChatRead(userId: string, chatId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(`update telegram_chats set unread = 0 where user_id = $1 and id = $2`, [
    userId,
    chatId,
  ]);
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
  await markChatRead(userId, chatId);
  const rows = await sql.query<{
    id: string;
    chat_id: string;
    from_self: boolean;
    author_name: string;
    body: string;
    created_at: string | Date;
    status: string | null;
  }>(
    `select id, chat_id, from_self, author_name, body, created_at, status
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
    status: row.status === "sending" ? "sending" : "sent",
  }));
}

export async function getChatKind(
  userId: string,
  chatId: string,
): Promise<TelegramChat["kind"] | null> {
  const sql = await getSql();
  const rows = await sql.query<{ kind: TelegramChat["kind"] }>(
    `select kind from telegram_chats where user_id = $1 and id = $2`,
    [userId, chatId],
  );
  return rows[0]?.kind ?? null;
}

export async function getChatPeer(
  userId: string,
  chatId: string,
): Promise<{ kind: TelegramChat["kind"]; peerId: string | null } | null> {
  const sql = await getSql();
  const rows = await sql.query<{ kind: TelegramChat["kind"]; peer_id: string | null }>(
    `select kind, peer_id from telegram_chats where user_id = $1 and id = $2`,
    [userId, chatId],
  );
  const row = rows[0];
  if (!row) return null;
  return { kind: row.kind, peerId: row.peer_id };
}

export async function savePeerPhoto(userId: string, peerId: string, bytes: Buffer): Promise<void> {
  if (!peerId || bytes.length < 80) return;
  const sql = await getSql();
  await sql.query(
    `insert into telegram_photos (user_id, peer_id, mime, bytes, updated_at)
     values ($1,$2,'image/jpeg',$3,now())
     on conflict (user_id, peer_id) do update set bytes = excluded.bytes, updated_at = now()`,
    [userId, peerId, bytes],
  );
}

export async function listPhotoPeers(userId: string): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql.query<{ peer_id: string }>(
    `select peer_id from telegram_photos where user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.peer_id);
}

export async function getPeerPhoto(
  userId: string,
  peerId: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const sql = await getSql();
  const rows = await sql.query<{ mime: string; bytes: Buffer }>(
    `select mime, bytes from telegram_photos where user_id = $1 and peer_id = $2`,
    [userId, peerId],
  );
  const row = rows[0];
  if (!row) return null;
  return { mime: row.mime, bytes: row.bytes };
}

export function chatPhotoUrl(peerId: string | null | undefined): string | null {
  if (!peerId) return null;
  return `/api/telegram/photo?p=${encodeURIComponent(peerId)}`;
}

export async function upsertUserChat(opts: {
  id: string;
  userId: string;
  title: string;
  peerId: string;
  unread: number;
  pinned: boolean;
  muted: boolean;
  lastPreview: string | null;
  lastAt: string | null;
  photoUrl?: string | null;
}): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into telegram_chats (id, user_id, kind, title, last_preview, last_at, unread, pinned, muted, peer_id, photo_url)
     values ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set
       title = excluded.title,
       last_preview = coalesce(excluded.last_preview, telegram_chats.last_preview),
       last_at = coalesce(excluded.last_at, telegram_chats.last_at),
       unread = excluded.unread,
       pinned = excluded.pinned,
       muted = excluded.muted,
       peer_id = excluded.peer_id,
       photo_url = coalesce(excluded.photo_url, telegram_chats.photo_url)`,
    [
      opts.id,
      opts.userId,
      opts.title.slice(0, 120),
      opts.lastPreview,
      opts.lastAt,
      opts.unread,
      opts.pinned,
      opts.muted,
      opts.peerId,
      opts.photoUrl ?? null,
    ],
  );
}

export async function sendNote(
  userId: string,
  chatId: string,
  body: string,
  authorName: string,
  opts?: { asSelf?: boolean },
): Promise<TelegramMessage> {
  const sql = await getSql();
  const chat = await sql.query<{ id: string; kind: string }>(
    `select id, kind from telegram_chats where user_id = $1 and id = $2`,
    [userId, chatId],
  );
  if (!chat[0]) throw new TelegramError("invalid", "Chat not found.", 404);
  if (chat[0].kind !== "notes") {
    throw new TelegramError("invalid", "This path can only write Studio notes.", 400);
  }
  return appendMessage({
    userId,
    chatId,
    fromSelf: opts?.asSelf ?? true,
    authorName,
    body,
  });
}

export async function updateReplicaProfile(
  userId: string,
  input: { firstName: string; lastName: string; about: string; username?: string },
): Promise<TelegramAccount> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const about = clampBio(input.about);
  assertBioLimit(about);
  if (!firstName) throw new TelegramError("invalid", "First name is required.", 400);
  if (firstName.length > 64 || lastName.length > 64) {
    throw new TelegramError("invalid", "Name is too long.", 400);
  }
  const replicaUsername =
    input.username === undefined ? undefined : sanitizeUsername(input.username);

  const sql = await getSql();
  if (replicaUsername === undefined) {
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
  } else {
    const updated = await sql.query<{ user_id: string }>(
      `update telegram_accounts
          set replica_first_name = $2,
              replica_last_name = $3,
              replica_about = $4,
              replica_username = $5,
              updated_at = now()
        where user_id = $1
        returning user_id`,
      [userId, firstName, lastName || null, about || null, replicaUsername],
    );
    if (!updated[0]) throw new TelegramError("unlinked", "Connect Telegram first.", 404);
  }
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
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const rows = await sql.query<{
    user_id: string;
    nonce: string;
    verifier: string;
  }>(
    `update telegram_oidc_tickets
        set used_at = now()
      where state = $1
        and used_at is null
        and created_at > $2
      returning user_id, nonce, verifier`,
    [state, cutoff],
  );
  return rows[0]
    ? { userId: rows[0].user_id, nonce: rows[0].nonce, verifier: rows[0].verifier }
    : null;
}
