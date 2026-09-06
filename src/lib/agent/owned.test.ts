import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyApproveDraft, applyMarkDelivered } from "./owned.ts";

function toSql(pg: PGlite): {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
} {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

describe("F01 markDelivered ownership", () => {
  it("foreign desk id does not mutate the other desk's thread", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
      create table agent_offers (
        id text primary key, user_id text not null, thread_id text not null,
        status text not null, delivered_at timestamptz
      );
      create table agent_threads (
        id text primary key, user_id text not null,
        workflow text not null, state text not null
      );
      insert into agent_offers values
        ('off_bbbbbbbbbbbbbbbb', 'desk_b', 'thr_bbbbbbbbbbbbbbbb', 'paid', null);
      insert into agent_threads values
        ('thr_bbbbbbbbbbbbbbbb', 'desk_b', 'W9_FULFILL', 'fulfilling');
    `);
    const sql = toSql(pg);
    const result = await applyMarkDelivered(sql, "desk_a", "off_bbbbbbbbbbbbbbbb");
    assert.equal(result.ok, false);
    const offer = (await pg.query<{ status: string }>("select status from agent_offers")).rows[0];
    const thread = (await pg.query<{ workflow: string; state: string }>(
      "select workflow, state from agent_threads",
    )).rows[0];
    assert.equal(offer.status, "paid");
    assert.equal(thread.workflow, "W9_FULFILL");
    assert.equal(thread.state, "fulfilling");
    await pg.close();
  });

  it("owned paid offer attests delivery and moves only that thread", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
      create table agent_offers (
        id text primary key, user_id text not null, thread_id text not null,
        status text not null, delivered_at timestamptz
      );
      create table agent_threads (
        id text primary key, user_id text not null,
        workflow text not null, state text not null
      );
      insert into agent_offers values
        ('off_aaaaaaaaaaaaaaaa', 'desk_a', 'thr_aaaaaaaaaaaaaaaa', 'paid', null),
        ('off_bbbbbbbbbbbbbbbb', 'desk_b', 'thr_bbbbbbbbbbbbbbbb', 'paid', null);
      insert into agent_threads values
        ('thr_aaaaaaaaaaaaaaaa', 'desk_a', 'W9_FULFILL', 'fulfilling'),
        ('thr_bbbbbbbbbbbbbbbb', 'desk_b', 'W9_FULFILL', 'fulfilling');
    `);
    const sql = toSql(pg);
    const result = await applyMarkDelivered(sql, "desk_a", "off_aaaaaaaaaaaaaaaa");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.threadId, "thr_aaaaaaaaaaaaaaaa");
    const a = (
      await pg.query<{ status: string }>(
        "select status from agent_offers where id = 'off_aaaaaaaaaaaaaaaa'",
      )
    ).rows[0];
    const b = (
      await pg.query<{ status: string; workflow?: string }>(
        "select status from agent_offers where id = 'off_bbbbbbbbbbbbbbbb'",
      )
    ).rows[0];
    const ta = (
      await pg.query<{ workflow: string; state: string }>(
        "select workflow, state from agent_threads where id = 'thr_aaaaaaaaaaaaaaaa'",
      )
    ).rows[0];
    const tb = (
      await pg.query<{ workflow: string; state: string }>(
        "select workflow, state from agent_threads where id = 'thr_bbbbbbbbbbbbbbbb'",
      )
    ).rows[0];
    assert.equal(a.status, "delivered");
    assert.equal(b.status, "paid");
    assert.equal(ta.workflow, "W10_AFTERCARE");
    assert.equal(ta.state, "aftercare");
    assert.equal(tb.workflow, "W9_FULFILL");
    assert.equal(tb.state, "fulfilling");
    await pg.close();
  });

  it("unpaid offer is a no-op", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
      create table agent_offers (
        id text primary key, user_id text not null, thread_id text not null,
        status text not null, delivered_at timestamptz
      );
      create table agent_threads (
        id text primary key, user_id text not null,
        workflow text not null, state text not null
      );
      insert into agent_offers values
        ('off_aaaaaaaaaaaaaaaa', 'desk_a', 'thr_aaaaaaaaaaaaaaaa', 'sent', null);
      insert into agent_threads values
        ('thr_aaaaaaaaaaaaaaaa', 'desk_a', 'W8_OFFER', 'awaiting_pay');
    `);
    const sql = toSql(pg);
    const result = await applyMarkDelivered(sql, "desk_a", "off_aaaaaaaaaaaaaaaa");
    assert.equal(result.ok, false);
    const thread = (
      await pg.query<{ workflow: string }>("select workflow from agent_threads")
    ).rows[0];
    assert.equal(thread.workflow, "W8_OFFER");
    await pg.close();
  });
});

describe("F16 approveDraft is never sent", () => {
  it("foreign draft id does not relabel the other desk's message", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
      create table agent_messages (
        id text primary key, user_id text not null, thread_id text not null,
        role text not null, status text not null, body text not null, auto boolean default false
      );
      create table agent_threads (
        id text primary key, user_id text not null, state text not null, unread int default 1
      );
      insert into agent_messages values
        ('msg_bbbbbbbbbbbbbbbb', 'desk_b', 'thr_bbbbbbbbbbbbbbbb', 'draft', 'held', 'hi from b', false);
      insert into agent_threads values
        ('thr_bbbbbbbbbbbbbbbb', 'desk_b', 'held', 1);
    `);
    const sql = toSql(pg);
    const result = await applyApproveDraft(sql, "desk_a", "msg_bbbbbbbbbbbbbbbb");
    assert.equal(result.ok, false);
    const msg = (await pg.query<{ role: string; status: string }>("select role, status from agent_messages")).rows[0];
    assert.equal(msg.role, "draft");
    assert.equal(msg.status, "held");
    await pg.close();
  });

  it("owned draft becomes approved, not sent", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
      create table agent_messages (
        id text primary key, user_id text not null, thread_id text not null,
        role text not null, status text not null, body text not null, auto boolean default false
      );
      create table agent_threads (
        id text primary key, user_id text not null, state text not null, unread int default 1
      );
      insert into agent_messages values
        ('msg_aaaaaaaaaaaaaaaa', 'desk_a', 'thr_aaaaaaaaaaaaaaaa', 'draft', 'held', 'local draft', false);
      insert into agent_threads values
        ('thr_aaaaaaaaaaaaaaaa', 'desk_a', 'held', 1);
    `);
    const sql = toSql(pg);
    const result = await applyApproveDraft(sql, "desk_a", "msg_aaaaaaaaaaaaaaaa");
    assert.equal(result.ok, true);
    const msg = (
      await pg.query<{ role: string; status: string; auto: boolean }>(
        "select role, status, auto from agent_messages",
      )
    ).rows[0];
    assert.equal(msg.role, "draft");
    assert.equal(msg.status, "approved");
    assert.equal(msg.auto, false);
    await pg.close();
  });
});
