import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyPaidWebhookOn } from "./settle.ts";
import { quote } from "./catalog.ts";
import { followDiscountHeld } from "./follows.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

const SCHEMA = `
  create table desk_billing (
    user_id text primary key,
    personas_cap integer not null default 1,
    paid_cycles integer not null default 0,
    lifetime_cents integer not null default 0,
    first_paid_at timestamptz,
    follow_discount_used boolean not null default false,
    created_at timestamptz not null default now()
  );
  create table desk_credit_lots (
    id text primary key,
    user_id text not null,
    kind text not null check (kind in ('refill', 'topup')),
    threads_original integer not null,
    threads_remaining integer not null,
    expires_at timestamptz,
    invoice_id text,
    created_at timestamptz not null default now()
  );
  create unique index desk_credit_lots_invoice_uidx on desk_credit_lots (invoice_id) where invoice_id is not null;
  create table desk_invoices (
    id text primary key,
    user_id text not null,
    rail text not null,
    sku text not null,
    threads integer not null,
    amount_cents integer not null,
    discount_cents integer not null default 0,
    status text not null,
    external_id text,
    payload text not null default '{}',
    created_at timestamptz not null default now(),
    paid_at timestamptz,
    expires_at timestamptz,
    check (status in ('creating', 'pending', 'uncertain', 'paid', 'expired', 'underpay', 'cancelled'))
  );
  create table desk_webhook_events (
    id text primary key,
    rail text not null,
    external_id text not null,
    invoice_id text,
    raw_sha256 text not null,
    accepted boolean not null default false,
    reason text,
    status text not null default 'received',
    created_at timestamptz not null default now()
  );
  create unique index desk_webhook_events_sha_idx on desk_webhook_events (rail, raw_sha256);
`;

describe("applyPaidWebhookOn", () => {
  it("does not mint on a bad signature", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await pg.exec(`
      insert into desk_invoices (id, user_id, rail, sku, threads, amount_cents, discount_cents, status)
      values ('inv_aaaaaaaaaaaaaaaa','desk_a','plisio','pack:starter',250,2900,0,'pending');
    `);
    const result = await applyPaidWebhookOn(toSql(pg), {
      raw: '{"status":"completed"}',
      payload: { status: "completed" },
      signatureOk: false,
      status: "completed",
      invoiceId: "inv_aaaaaaaaaaaaaaaa",
      externalId: "txn_bad",
      paidAmountCents: 2900,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad_signature");
    const inv = (await pg.query<{ status: string }>("select status from desk_invoices")).rows[0];
    assert.equal(inv.status, "pending");
    const lots = (await pg.query<{ n: number }>("select count(*)::int as n from desk_credit_lots")).rows[0];
    assert.equal(lots.n, 0);
    await pg.close();
  });

  it("sets underpay and does not mint", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await pg.exec(`
      insert into desk_invoices (id, user_id, rail, sku, threads, amount_cents, discount_cents, status)
      values ('inv_bbbbbbbbbbbbbbbb','desk_a','plisio','pack:starter',250,2900,0,'pending');
    `);
    const result = await applyPaidWebhookOn(toSql(pg), {
      raw: '{"status":"mismatch","source_amount":"10.00"}',
      payload: { status: "mismatch" },
      signatureOk: true,
      status: "mismatch",
      invoiceId: "inv_bbbbbbbbbbbbbbbb",
      externalId: "txn_short",
      paidAmountCents: 1000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "underpay");
    const inv = (await pg.query<{ status: string }>("select status from desk_invoices")).rows[0];
    assert.equal(inv.status, "underpay");
    const lots = (await pg.query<{ n: number }>("select count(*)::int as n from desk_credit_lots")).rows[0];
    assert.equal(lots.n, 0);
    await pg.close();
  });

  it("sets expired on a late completed callback and does not mint", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await pg.exec(`
      insert into desk_invoices (id, user_id, rail, sku, threads, amount_cents, discount_cents, status, expires_at)
      values ('inv_cccccccccccccccc','desk_a','plisio','pack:starter',250,2900,0,'pending', now() - interval '1 hour');
    `);
    const result = await applyPaidWebhookOn(toSql(pg), {
      raw: '{"status":"completed","late":true}',
      payload: { status: "completed" },
      signatureOk: true,
      status: "completed",
      invoiceId: "inv_cccccccccccccccc",
      externalId: "txn_late",
      paidAmountCents: 2900,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "expired");
    const inv = (await pg.query<{ status: string }>("select status from desk_invoices")).rows[0];
    assert.equal(inv.status, "expired");
    const lots = (await pg.query<{ n: number }>("select count(*)::int as n from desk_credit_lots")).rows[0];
    assert.equal(lots.n, 0);
    await pg.close();
  });

  it("sets uncertain on an error status and does not mint", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await pg.exec(`
      insert into desk_invoices (id, user_id, rail, sku, threads, amount_cents, discount_cents, status)
      values ('inv_eeeeeeeeeeeeeeee','desk_a','plisio','pack:starter',250,2900,0,'pending');
    `);
    const result = await applyPaidWebhookOn(toSql(pg), {
      raw: '{"status":"error"}',
      payload: { status: "error" },
      signatureOk: true,
      status: "error",
      invoiceId: "inv_eeeeeeeeeeeeeeee",
      externalId: "txn_err",
      paidAmountCents: 2900,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "uncertain");
    const inv = (await pg.query<{ status: string }>("select status from desk_invoices")).rows[0];
    assert.equal(inv.status, "uncertain");
    const lots = (await pg.query<{ n: number }>("select count(*)::int as n from desk_credit_lots")).rows[0];
    assert.equal(lots.n, 0);
    await pg.close();
  });

  it("mints once then replays the same raw_sha256 without extra lots", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await pg.exec(`
      insert into desk_invoices (id, user_id, rail, sku, threads, amount_cents, discount_cents, status)
      values ('inv_dddddddddddddddd','desk_a','plisio','pack:starter',250,2900,0,'pending');
    `);
    const sql = toSql(pg);
    const input = {
      raw: '{"status":"completed","order_number":"inv_dddddddddddddddd"}',
      payload: { status: "completed" },
      signatureOk: true,
      status: "completed",
      invoiceId: "inv_dddddddddddddddd",
      externalId: "txn_ok",
      paidAmountCents: 2900,
    };
    const first = await applyPaidWebhookOn(sql, input);
    assert.equal(first.ok, true);
    assert.equal(first.minted, 250);
    assert.equal(first.replay ?? false, false);
    const second = await applyPaidWebhookOn(sql, input);
    assert.equal(second.ok, true);
    assert.equal(second.replay, true);
    assert.equal(second.minted, 0);
    const lots = (
      await pg.query<{ n: number; remaining: number }>(
        "select count(*)::int as n, coalesce(sum(threads_remaining),0)::int as remaining from desk_credit_lots",
      )
    ).rows[0];
    assert.equal(lots.n, 1);
    assert.equal(lots.remaining, 250);
    const inv = (await pg.query<{ status: string }>("select status from desk_invoices")).rows[0];
    assert.equal(inv.status, "paid");
    await pg.close();
  });

  it("unbound invoice id does not mint", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    const result = await applyPaidWebhookOn(toSql(pg), {
      raw: '{"status":"completed"}',
      payload: { status: "completed" },
      signatureOk: true,
      status: "completed",
      invoiceId: "inv_missingmissingmm",
      externalId: "txn_none",
      paidAmountCents: 2900,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unbound");
    const lots = (await pg.query<{ n: number }>("select count(*)::int as n from desk_credit_lots")).rows[0];
    assert.equal(lots.n, 0);
    await pg.close();
  });

  it("replays a rejected underpay body without minting", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    await pg.exec(`
      insert into desk_invoices (id, user_id, rail, sku, threads, amount_cents, discount_cents, status)
      values ('inv_ffffffffffff','desk_a','plisio','pack:starter',250,2900,0,'pending');
    `);
    const sql = toSql(pg);
    const input = {
      raw: '{"status":"mismatch","source_amount":"5.00"}',
      payload: { status: "mismatch" },
      signatureOk: true,
      status: "mismatch",
      invoiceId: "inv_ffffffffffff",
      externalId: "txn_short2",
      paidAmountCents: 500,
    };
    const first = await applyPaidWebhookOn(sql, input);
    assert.equal(first.reason, "underpay");
    const second = await applyPaidWebhookOn(sql, input);
    assert.equal(second.ok, false);
    assert.equal(second.reason, "underpay");
    const lots = (await pg.query<{ n: number }>("select count(*)::int as n from desk_credit_lots")).rows[0];
    assert.equal(lots.n, 0);
    await pg.close();
  });
});

describe("follow discount hold", () => {
  it("applies $5 off once; an open discounted invoice consumes the hold", () => {
    const eligible = quote({
      skuId: "pack:starter",
      multiples: 1,
      firstPayment: true,
      followsVerified: true,
      discountAlreadyUsed: false,
    });
    assert.equal(eligible.discountCents, 500);
    assert.equal(eligible.amountCents, 2400);
    assert.equal(followDiscountHeld([{ discountCents: 500, status: "pending" }]), true);
    assert.equal(followDiscountHeld([{ discountCents: 500, status: "uncertain" }]), true);
    const held = quote({
      skuId: "pack:starter",
      multiples: 1,
      firstPayment: true,
      followsVerified: true,
      discountAlreadyUsed: true,
    });
    assert.equal(held.discountCents, 0);
    assert.equal(held.amountCents, 2900);
  });

  it("a client followsVerified boolean does not apply the discount by itself", () => {
    const quoted = quote({
      skuId: "pack:starter",
      multiples: 1,
      firstPayment: true,
      followsVerified: false,
      discountAlreadyUsed: false,
    });
    assert.equal(quoted.discountCents, 0);
    assert.equal(quoted.amountCents, 2900);
  });
});
