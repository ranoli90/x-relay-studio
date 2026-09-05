import { createHash } from "node:crypto";
import { newId } from "../agent/ids.ts";
import { TelegramError } from "./errors.ts";

export type SendIntent = {
  id: string;
  status: "pending" | "sent" | "uncertain" | "failed";
  telegramMessageId: string | null;
};

export type IntentSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function sha(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export async function applyBeginSendIntent(
  sql: IntentSql,
  input: { userId: string; chatId: string; peerId: string; body: string; id?: string },
): Promise<{ intentId: string; reuse?: SendIntent }> {
  const bodySha = sha(input.body);
  const recent = (
    await sql.query<{
      id: string;
      status: SendIntent["status"];
      telegram_message_id: string | null;
    }>(
      `select id, status, telegram_message_id from telegram_send_intents
        where user_id = $1 and chat_id = $2 and body_sha256 = $3
          and created_at > now() - interval '2 minutes'
        order by created_at desc limit 1`,
      [input.userId, input.chatId, bodySha],
    )
  )[0];
  if (recent?.status === "sent") {
    return {
      intentId: recent.id,
      reuse: { id: recent.id, status: "sent", telegramMessageId: recent.telegram_message_id },
    };
  }
  if (recent?.status === "pending" || recent?.status === "uncertain") {
    throw new TelegramError(
      "flood",
      "Previous send is still confirming. Wait a moment before retrying.",
      429,
      5,
    );
  }
  const id = input.id ?? newId("snd");
  try {
    await sql.query(
      `insert into telegram_send_intents
         (id, user_id, chat_id, peer_id, body_sha256, body, status)
       values ($1,$2,$3,$4,$5,$6,'pending')`,
      [id, input.userId, input.chatId, input.peerId, bodySha, input.body],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(msg)) {
      throw new TelegramError(
        "flood",
        "Previous send is still confirming. Wait a moment before retrying.",
        429,
        5,
      );
    }
    throw err;
  }
  return { intentId: id };
}

export async function applyCompleteSendIntent(
  sql: IntentSql,
  intentId: string,
  userId: string,
  telegramMessageId: number | string | null,
): Promise<boolean> {
  const rows = await sql.query<{ id: string }>(
    `update telegram_send_intents
        set status = 'sent',
            telegram_message_id = $3,
            completed_at = now()
      where id = $1 and user_id = $2 and status = 'pending'
      returning id`,
    [intentId, userId, telegramMessageId != null ? String(telegramMessageId) : null],
  );
  return Boolean(rows[0]);
}

export async function applyFailSendIntent(
  sql: IntentSql,
  intentId: string,
  userId: string,
  outcome: "uncertain" | "failed",
  error: string,
): Promise<boolean> {
  const rows = await sql.query<{ id: string }>(
    `update telegram_send_intents
        set status = $3,
            error = $4,
            completed_at = now()
      where id = $1 and user_id = $2 and status = 'pending'
      returning id`,
    [intentId, userId, outcome, error.slice(0, 240)],
  );
  return Boolean(rows[0]);
}

export async function beginSendIntent(input: {
  userId: string;
  chatId: string;
  peerId: string;
  body: string;
}): Promise<{ intentId: string; reuse?: SendIntent }> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  return applyBeginSendIntent(sql, input);
}

export async function completeSendIntent(
  intentId: string,
  userId: string,
  telegramMessageId: number | string | null,
): Promise<void> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await applyCompleteSendIntent(sql, intentId, userId, telegramMessageId);
}

export async function failSendIntent(
  intentId: string,
  userId: string,
  outcome: "uncertain" | "failed",
  error: string,
): Promise<void> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await applyFailSendIntent(sql, intentId, userId, outcome, error);
}

export function sendOutcomeFromError(err: unknown): "uncertain" | "failed" {
  if (err instanceof TelegramError) {
    if (err.status === 503 || err.status === 504) return "uncertain";
    if (err.code === "flood" && /too long|couldn.?t reach|didn.?t answer/i.test(err.message)) {
      return "uncertain";
    }
    if (err.code === "flood" || err.code === "peer_flood") return "failed";
    if (err.code === "auth_dead" || err.code === "unlinked" || err.code === "invalid") return "failed";
    return "uncertain";
  }
  if (err instanceof Error && /timeout|abort|network|fetch/i.test(err.message)) return "uncertain";
  return "uncertain";
}
