import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyMarkPaid, FanPaySchema, fanWebhookAuthorized } from "./pay.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

const SCHEMA = `
  create table agent_offers (
    id text primary key, user_id text not null, thread_id text not null, fan_id text not null,
    status text not null, price_cents integer not null, paid_at timestamptz, delivered_at timestamptz
  );
  create table agent_payments (
    id text primary key, user_id text not null, offer_id text not null,
    rail text not null, amount_cents integer not null, status text not null,
    external_id text, paid_at timestamptz
  );
  create unique index agent_payments_ext_uidx on agent_payments (rail, external_id)
    where external_id is not null;
  create unique index agent_payments_offer_uidx on agent_payments (offer_id);
  create table agent_fans (
    id text primary key, user_id text not null, lifetime_cents integer not null, trust integer not null
  );
  create table agent_threads (
    id text primary key, user_id text not null, workflow text not null, state text not null
  );
  create table agent_jobs (
    id text primary key, user_id text not null, thread_id text, kind text not null,
    run_at timestamptz, payload text, status text, done_at timestamptz
  );
`;

async function seed(pg: PGlite) {
  await pg.exec(`
    insert into agent_offers values
      ('off_aaaaaaaaaaaaaaaa','desk_a','thr_a','fan_a','sent',5000,null,null);
    insert into agent_fans values ('fan_a','desk_a',0,20);
    insert into agent_threads values ('thr_a','desk_a','W8_OFFER','awaiting_pay');
  `);
}

describe("F08 fan payment settlement", () => {
  it("FanPaySchema ignores a client userId and requires offer fields", () => {
    const parsed = FanPaySchema.parse({
      userId: "attacker",
      offerId: "off_aaaaaaaaaaaaaaaa",
      rail: "throne",
      externalId: "wh_1",
      amountCents: "5000",
    });
    assert.equal("userId" in parsed, false);
    assert.equal(parsed.amountCents, 5000);
    assert.equal(FanPaySchema.safeParse({ rail: "throne" }).success, false);
  });

  it("fanWebhookAuthorized requires PAYMENTS_WEBHOOK_SECRET and never CRON_SECRET", () => {
    assert.equal(fanWebhookAuthorized("Bearer cron", "pay-secret"), false);
    assert.equal(fanWebhookAuthorized("Bearer cron", undefined), false);
    assert.equal(fanWebhookAuthorized("Bearer pay-secret", undefined), false);
    assert.equal(fanWebhookAuthorized("Bearer pay-secret", "pay-secret"), true);
    assert.equal(fanWebhookAuthorized("Bearer pay-secret", " pay-secret "), true);
    assert.equal(fanWebhookAuthorized(null, "pay-secret"), false);
    assert.equal(fanWebhookAuthorized("pay-secret", "pay-secret"), false);
  });

  it("rejects a foreign desk offer and wrong amount", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await seed(pg);
    const sql = toSql(pg);
    const foreign = await applyMarkPaid(sql, "desk_b", {
      offerId: "off_aaaaaaaaaaaaaaaa",
      rail: "throne",
      externalId: "wh_1",
      amountCents: 5000,
    });
    assert.equal(foreign.ok, false);
    const wrong = await applyMarkPaid(sql, "desk_a", {
      offerId: "off_aaaaaaaaaaaaaaaa",
      rail: "throne",
      externalId: "wh_1",
      amountCents: 1,
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.reason, "amount_mismatch");
    const fan = (await pg.query<{ lifetime_cents: number }>("select lifetime_cents from agent_fans")).rows[0];
    assert.equal(fan.lifetime_cents, 0);
    const pays = (await pg.query<{ n: number }>("select count(*)::int as n from agent_payments")).rows[0];
    assert.equal(pays.n, 0);
    await pg.close();
  });

  it("missing offer is not_found with no paid writes", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await seed(pg);
    const sql = toSql(pg);
    const missing = await applyMarkPaid(sql, null, {
      offerId: "off_missingmissingmm",
      rail: "throne",
      externalId: "wh_x",
      amountCents: 5000,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, "not_found");
    const pays = (await pg.query<{ n: number }>("select count(*)::int as n from agent_payments")).rows[0];
    assert.equal(pays.n, 0);
    await pg.close();
  });

  it("webhook null userId takes the owner from the locked offer row", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await seed(pg);
    const sql = toSql(pg);
    const first = await applyMarkPaid(sql, null, {
      offerId: "off_aaaaaaaaaaaaaaaa",
      rail: "throne",
      externalId: "wh_body",
      amountCents: 5000,
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.replay, false);
      assert.equal(first.threadId, "thr_a");
    }
    const pay = (await pg.query<{ user_id: string; amount_cents: number }>(
      "select user_id, amount_cents from agent_payments",
    )).rows[0];
    assert.equal(pay.user_id, "desk_a");
    assert.equal(pay.amount_cents, 5000);
    await pg.close();
  });

  it("replays the same external id without a second lifetime increment", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await seed(pg);
    const sql = toSql(pg);
    const first = await applyMarkPaid(sql, null, {
      offerId: "off_aaaaaaaaaaaaaaaa",
      rail: "throne",
      externalId: "wh_same",
      amountCents: 5000,
    });
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.replay, false);
    const second = await applyMarkPaid(sql, null, {
      offerId: "off_aaaaaaaaaaaaaaaa",
      rail: "throne",
      externalId: "wh_same",
      amountCents: 5000,
    });
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.replay, true);
    const fan = (await pg.query<{ lifetime_cents: number }>("select lifetime_cents from agent_fans")).rows[0];
    assert.equal(fan.lifetime_cents, 5000);
    const pays = (await pg.query<{ n: number }>("select count(*)::int as n from agent_payments")).rows[0];
    assert.equal(pays.n, 1);
    await pg.close();
  });

  it("does not apply a stolen external id to a second unpaid offer", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await seed(pg);
    await pg.exec(`
      insert into agent_offers values
        ('off_bbbbbbbbbbbbbbbb','desk_a','thr_b','fan_b','sent',5000,null,null);
      insert into agent_fans values ('fan_b','desk_a',0,20);
      insert into agent_threads values ('thr_b','desk_a','W8_OFFER','awaiting_pay');
    `);
    const sql = toSql(pg);
    const first = await applyMarkPaid(sql, null, {
      offerId: "off_aaaaaaaaaaaaaaaa",
      rail: "throne",
      externalId: "wh_shared",
      amountCents: 5000,
    });
    assert.equal(first.ok, true);
    const stolen = await applyMarkPaid(sql, null, {
      offerId: "off_bbbbbbbbbbbbbbbb",
      rail: "throne",
      externalId: "wh_shared",
      amountCents: 5000,
    });
    assert.equal(stolen.ok, false);
    if (!stolen.ok) assert.ok(stolen.reason === "wrong_status" || stolen.reason === "conflict");
    const b = (
      await pg.query<{ status: string }>("select status from agent_offers where id = 'off_bbbbbbbbbbbbbbbb'")
    ).rows[0];
    assert.equal(b.status, "sent");
    const fanB = (
      await pg.query<{ lifetime_cents: number }>("select lifetime_cents from agent_fans where id = 'fan_b'")
    ).rows[0];
    assert.equal(fanB.lifetime_cents, 0);
    const fanA = (
      await pg.query<{ lifetime_cents: number }>("select lifetime_cents from agent_fans where id = 'fan_a'")
    ).rows[0];
    assert.equal(fanA.lifetime_cents, 5000);
    await pg.close();
  });

  it("draft offers are not payable", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await seed(pg);
    await pg.exec(`update agent_offers set status = 'draft' where id = 'off_aaaaaaaaaaaaaaaa'`);
    const sql = toSql(pg);
    const paid = await applyMarkPaid(sql, null, {
      offerId: "off_aaaaaaaaaaaaaaaa",
      rail: "throne",
      externalId: "wh_draft",
      amountCents: 5000,
    });
    assert.equal(paid.ok, false);
    if (!paid.ok) assert.equal(paid.reason, "wrong_status");
    const pays = (await pg.query<{ n: number }>("select count(*)::int as n from agent_payments")).rows[0];
    assert.equal(pays.n, 0);
    await pg.close();
  });
});
