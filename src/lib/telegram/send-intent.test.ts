import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { TelegramError } from "./errors.ts";
import {
  applyBeginSendIntent,
  applyCompleteSendIntent,
  applyFailSendIntent,
  sendOutcomeFromError,
} from "./send-intent.server.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

async function boot() {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    create table telegram_send_intents (
      id text primary key,
      user_id text not null,
      chat_id text not null,
      peer_id text not null,
      body_sha256 text not null,
      body text not null,
      status text not null default 'pending'
        check (status in ('pending', 'sent', 'uncertain', 'failed')),
      telegram_message_id text,
      error text,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    );
  `);
  return pg;
}

describe("durable human send intents", () => {
  it("marks sent only after provider ack and reuses an identical recent body", async () => {
    const pg = await boot();
    const sql = toSql(pg);
    const first = await applyBeginSendIntent(sql, {
      userId: "u1",
      chatId: "c1",
      peerId: "42",
      body: "hello there",
      id: "snd_1",
    });
    assert.equal(first.reuse, undefined);
    const acked = await applyCompleteSendIntent(sql, first.intentId, "u1", 99);
    assert.equal(acked, true);

    const second = await applyBeginSendIntent(sql, {
      userId: "u1",
      chatId: "c1",
      peerId: "42",
      body: "hello there",
      id: "snd_2",
    });
    assert.equal(second.reuse?.status, "sent");
    assert.equal(second.reuse?.telegramMessageId, "99");
    const count = (await pg.query<{ n: number }>(`select count(*)::int as n from telegram_send_intents`))
      .rows[0];
    assert.equal(count.n, 1);
    await pg.close();
  });

  it("distinct reply ids with the same body are separate intents after ack", async () => {
    const pg = await boot();
    const sql = toSql(pg);
    const first = await applyBeginSendIntent(sql, {
      userId: "u1",
      chatId: "c1",
      peerId: "42",
      body: "yes",
      id: "snd_r1",
      replyId: "rep_a",
    });
    assert.equal(await applyCompleteSendIntent(sql, first.intentId, "u1", 11), true);
    const second = await applyBeginSendIntent(sql, {
      userId: "u1",
      chatId: "c1",
      peerId: "42",
      body: "yes",
      id: "snd_r2",
      replyId: "rep_b",
    });
    assert.equal(second.reuse, undefined);
    assert.equal(second.intentId, "snd_r2");
    const count = (await pg.query<{ n: number }>(`select count(*)::int as n from telegram_send_intents`))
      .rows[0];
    assert.equal(count.n, 2);
    await pg.close();
  });

  it("marks unknown/network failures uncertain, not sent", async () => {
    const pg = await boot();
    const sql = toSql(pg);
    const started = await applyBeginSendIntent(sql, {
      userId: "u1",
      chatId: "c1",
      peerId: "42",
      body: "ping",
      id: "snd_n",
    });
    const outcome = sendOutcomeFromError(new Error("network timeout from fetch"));
    assert.equal(outcome, "uncertain");
    await applyFailSendIntent(sql, started.intentId, "u1", outcome, "network timeout from fetch");
    const row = (
      await pg.query<{ status: string }>(`select status from telegram_send_intents where id = 'snd_n'`)
    ).rows[0];
    assert.equal(row.status, "uncertain");
    await pg.close();
  });

  it("does not treat a 503 reachability miss as sent", async () => {
    assert.equal(
      sendOutcomeFromError(new TelegramError("flood", "Couldn't reach Telegram just now. Try again.", 503, 8)),
      "uncertain",
    );
    assert.equal(
      sendOutcomeFromError(new TelegramError("flood", "Telegram asked us to wait 17 seconds.", 429, 17)),
      "failed",
    );
    assert.equal(
      sendOutcomeFromError(new TelegramError("auth_dead", "Telegram signed this desk out.", 401)),
      "failed",
    );
  });

  it("does not unsend after provider ack, and blocks retry of an in-flight body", async () => {
    const pg = await boot();
    const sql = toSql(pg);
    const started = await applyBeginSendIntent(sql, {
      userId: "u1",
      chatId: "c1",
      peerId: "42",
      body: "once",
      id: "snd_ack",
    });
    await assert.rejects(
      () =>
        applyBeginSendIntent(sql, {
          userId: "u1",
          chatId: "c1",
          peerId: "42",
          body: "once",
          id: "snd_dup",
        }),
      (err: unknown) => err instanceof TelegramError && err.code === "flood",
    );
    assert.equal(await applyCompleteSendIntent(sql, started.intentId, "u1", 7), true);
    assert.equal(await applyFailSendIntent(sql, started.intentId, "u1", "uncertain", "late fail"), false);
    const row = (
      await pg.query<{ status: string; telegram_message_id: string | null }>(
        `select status, telegram_message_id from telegram_send_intents where id = 'snd_ack'`,
      )
    ).rows[0];
    assert.equal(row.status, "sent");
    assert.equal(row.telegram_message_id, "7");
    await pg.close();
  });
});
