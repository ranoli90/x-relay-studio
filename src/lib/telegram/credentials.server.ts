import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { decryptSecret, encryptSecret } from "./crypto.server";
import { botDeleteWebhook, botGetMe, botGetUpdates, botSetWebhook, type TelegramUpdate } from "./bot.server";
import { helloDeepLink, helperChatId, maskBotToken, parseBotToken, parseStartPayload } from "./bot-token";
import { parseChecksJson, type TelegramCheckResult } from "./checks";
import { TelegramError } from "./errors";
import { publicOrigin } from "./config.server";
import { appendMessage, seedHelperChat, seedStudioNotes, upsertLinkedAccount } from "./snapshot.server";
import type { TelegramCredentialPublic, TelegramOnboardingStep } from "./types";
import { pickCredentialFields } from "./validate";

export type CredentialRow = {
  user_id: string;
  bot_token_enc: string;
  bot_id: number | string | null;
  bot_username: string | null;
  bot_name: string | null;
  token_hint: string | null;
  start_payload: string | null;
  start_payload_exp: string | Date | null;
  webhook_secret: string | null;
  webhook_active: boolean;
  last_update_id: number | string | null;
  hello_at: string | Date | null;
  checks_json: string | null;
  onboarded_at: string | Date | null;
};

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function freshPayload(): { payload: string; exp: string } {
  return {
    payload: randomBytes(16).toString("hex"),
    exp: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

export function deriveStep(row: CredentialRow | null): TelegramOnboardingStep {
  if (!row) return "welcome";
  if (!row.hello_at) return "phone";
  if (!row.onboarded_at) return "checks";
  return "done";
}

export function toPublic(row: CredentialRow | null): TelegramCredentialPublic | null {
  if (!row) return null;
  const payloadExpired =
    row.start_payload_exp && new Date(iso(row.start_payload_exp) ?? 0).getTime() < Date.now();
  const payload = payloadExpired ? null : row.start_payload;
  return {
    hasToken: true,
    botUsername: row.bot_username,
    botName: row.bot_name,
    botId: num(row.bot_id),
    tokenHint: row.token_hint,
    helloLink: helloDeepLink(row.bot_username, payload),
    helloReceived: Boolean(row.hello_at),
    onboarded: Boolean(row.onboarded_at),
    webhookActive: Boolean(row.webhook_active),
    checks: parseChecksJson(row.checks_json),
    step: deriveStep(row),
  };
}

export async function getCredentialRow(userId: string): Promise<CredentialRow | null> {
  const sql = await getSql();
  const rows = await sql.query<CredentialRow>(
    `select user_id, bot_token_enc, bot_id, bot_username, bot_name, token_hint,
            start_payload, start_payload_exp, webhook_secret, webhook_active,
            last_update_id, hello_at, checks_json, onboarded_at
       from telegram_credentials where user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function getDecryptedToken(userId: string): Promise<string | null> {
  const row = await getCredentialRow(userId);
  if (!row) return null;
  try {
    return decryptSecret(row.bot_token_enc);
  } catch {
    return null;
  }
}

async function writeRow(
  userId: string,
  fields: Record<string, unknown>,
): Promise<CredentialRow> {
  const sql = await getSql();
  const safe = pickCredentialFields(fields);
  const keys = Object.keys(safe);
  if (keys.length === 0) {
    const existing = await getCredentialRow(userId);
    if (!existing) throw new TelegramError("invalid", "No helper key saved yet.", 400);
    return existing;
  }
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const values = keys.map((k) => safe[k]);
  await sql.query(
    `update telegram_credentials set ${sets}, updated_at = now() where user_id = $1`,
    [userId, ...values],
  );
  const row = await getCredentialRow(userId);
  if (!row) throw new TelegramError("invalid", "No helper key saved yet.", 400);
  return row;
}

export async function saveBotToken(userId: string, rawToken: string, request: Request): Promise<CredentialRow> {
  const parsed = parseBotToken(rawToken);
  if (!parsed) {
    throw new TelegramError(
      "bad_key",
      "That doesn’t look like a helper key. Copy the whole code BotFather sent you.",
      400,
    );
  }

  const me = await botGetMe(parsed.token);
  if (!me.is_bot) {
    throw new TelegramError("bad_key", "That key didn’t work. Copy it again from BotFather.", 400);
  }

  await botDeleteWebhook(parsed.token);

  const { payload, exp } = freshPayload();
  const webhookSecret = randomBytes(24).toString("hex");
  const enc = encryptSecret(parsed.token);
  const hint = maskBotToken(parsed.token);
  const origin = publicOrigin(request);
  const hookUrl = `${origin}/api/telegram/bot/hook`;
  const https = origin.startsWith("https://");
  let webhookActive = false;
  if (https) {
    webhookActive = await botSetWebhook(parsed.token, hookUrl, webhookSecret);
  }

  const sql = await getSql();
  await sql.query(
    `insert into telegram_credentials (
        user_id, bot_token_enc, bot_id, bot_username, bot_name, token_hint,
        start_payload, start_payload_exp, webhook_secret, webhook_active,
        last_update_id, hello_at, checks_json, onboarded_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,null,'{}',null,now())
      on conflict (user_id) do update set
        bot_token_enc = excluded.bot_token_enc,
        bot_id = excluded.bot_id,
        bot_username = excluded.bot_username,
        bot_name = excluded.bot_name,
        token_hint = excluded.token_hint,
        start_payload = excluded.start_payload,
        start_payload_exp = excluded.start_payload_exp,
        webhook_secret = excluded.webhook_secret,
        webhook_active = excluded.webhook_active,
        last_update_id = null,
        hello_at = null,
        checks_json = '{}',
        onboarded_at = null,
        updated_at = now()`,
    [
      userId,
      enc,
      me.id,
      me.username ?? null,
      me.first_name,
      hint,
      payload,
      exp,
      webhookSecret,
      webhookActive,
    ],
  );

  console.info("[telegram]", {
    event: "key_saved",
    userId,
    botId: me.id,
    webhookActive,
  });
  const row = await getCredentialRow(userId);
  if (!row) throw new TelegramError("invalid", "Could not save the helper key.", 500);
  return row;
}

export async function refreshHelloPayload(userId: string): Promise<CredentialRow> {
  const row = await getCredentialRow(userId);
  if (!row) throw new TelegramError("invalid", "Save a helper key first.", 400);
  const exp = row.start_payload_exp ? new Date(iso(row.start_payload_exp) ?? 0).getTime() : 0;
  if (row.start_payload && exp > Date.now() + 60_000) return row;
  const { payload, exp: nextExp } = freshPayload();
  return writeRow(userId, { start_payload: payload, start_payload_exp: nextExp });
}

async function applyHelloFromUser(
  userId: string,
  from: { id: number; first_name: string; last_name?: string; username?: string },
): Promise<void> {
  const account = await upsertLinkedAccount({
    userId,
    telegramUserId: from.id,
    firstName: from.first_name,
    lastName: from.last_name ?? null,
    username: from.username ?? null,
    photoUrl: null,
    botCanWrite: true,
    path: "oidc",
    preview: false,
  });
  const cred = await getCredentialRow(userId);
  await seedStudioNotes(userId, account.displayName);
  await seedHelperChat(userId, cred?.bot_name ?? "Helper", from.first_name);
  await writeRow(userId, { hello_at: new Date().toISOString() });
  console.info("[telegram]", { event: "hello", userId, telegramUserId: from.id });
}

function messageOf(update: TelegramUpdate) {
  return update.message ?? update.edited_message ?? null;
}

export async function ingestUpdates(userId: string, updates: TelegramUpdate[]): Promise<boolean> {
  const row = await getCredentialRow(userId);
  if (!row) return false;
  let hello = Boolean(row.hello_at);
  let maxId = num(row.last_update_id) ?? 0;
  const payload = row.start_payload;
  const chatId = helperChatId(userId);

  for (const update of updates) {
    if (update.update_id > maxId) maxId = update.update_id;
    const msg = messageOf(update);
    if (!msg?.from) continue;
    const text = (msg.text ?? "").trim();
    if (!text) continue;

    if (!hello && !msg.from.is_bot) {
      const got = parseStartPayload(text);
      if (payload && got === payload) {
        await applyHelloFromUser(userId, msg.from);
        hello = true;
      }
    }

    if (!hello) continue;

    try {
      await appendMessage({
        userId,
        chatId,
        fromSelf: !msg.from.is_bot,
        authorName: msg.from.is_bot
          ? (row.bot_name ?? "Helper")
          : msg.from.first_name,
        body: text,
        telegramMessageId: msg.message_id,
      });
    } catch {
      // chat may not exist until hello seeds it; ignore a single miss
    }
  }

  if (maxId) {
    await writeRow(userId, { last_update_id: maxId });
  }
  return hello;
}

export async function pullUpdates(userId: string): Promise<boolean> {
  const row = await getCredentialRow(userId);
  if (!row) return false;
  if (row.webhook_active) return Boolean(row.hello_at);
  const token = await getDecryptedToken(userId);
  if (!token) return false;
  const offset = num(row.last_update_id);
  try {
    const updates = await botGetUpdates(token, offset ? offset + 1 : undefined);
    return ingestUpdates(userId, updates);
  } catch (err) {
    if (err instanceof TelegramError && (err.code === "invalid" || err.code === "bad_key")) {
      return Boolean(row.hello_at);
    }
    throw err;
  }
}

export async function findByWebhookSecret(secret: string): Promise<CredentialRow | null> {
  if (!secret) return null;
  const sql = await getSql();
  const rows = await sql.query<CredentialRow>(
    `select user_id, bot_token_enc, bot_id, bot_username, bot_name, token_hint,
            start_payload, start_payload_exp, webhook_secret, webhook_active,
            last_update_id, hello_at, checks_json, onboarded_at
       from telegram_credentials where webhook_secret = $1`,
    [secret],
  );
  return rows[0] ?? null;
}

export async function saveChecks(userId: string, checks: TelegramCheckResult[]): Promise<void> {
  await writeRow(userId, { checks_json: JSON.stringify(checks) });
}

export async function markOnboarded(userId: string): Promise<CredentialRow> {
  return writeRow(userId, { onboarded_at: new Date().toISOString() });
}

export async function deleteCredentials(userId: string): Promise<void> {
  const token = await getDecryptedToken(userId);
  if (token) await botDeleteWebhook(token);
  const sql = await getSql();
  await sql.query(`delete from telegram_credentials where user_id = $1`, [userId]);
}
