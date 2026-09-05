import { createHash } from "node:crypto";
import { newId } from "@/lib/agent/ids";
import { getSql } from "@/lib/db";
import { quote, type Quote } from "./catalog.ts";
import { acceptPaid } from "./verify.ts";

export type BillingRow = {
  user_id: string;
  personas_cap: number;
  paid_cycles: number;
  lifetime_cents: number;
  first_paid_at: string | Date | null;
  follow_discount_used: boolean;
};

export type InvoiceRow = {
  id: string;
  user_id: string;
  rail: string;
  sku: string;
  threads: number;
  amount_cents: number;
  discount_cents: number;
  status: string;
  external_id: string | null;
  payload: string;
  created_at: string | Date;
  paid_at: string | Date | null;
  expires_at: string | Date | null;
};

export async function loadBilling(userId: string): Promise<BillingRow> {
  const sql = await getSql();
  const rows = await sql.query<BillingRow>(
    `insert into desk_billing (user_id) values ($1)
     on conflict (user_id) do update set user_id = excluded.user_id
     returning user_id, personas_cap, paid_cycles, lifetime_cents, first_paid_at, follow_discount_used`,
    [userId],
  );
  return rows[0];
}

export async function quoteForUser(
  userId: string,
  skuId: string,
  multiples: number,
  followsVerified: boolean,
): Promise<Quote> {
  const billing = await loadBilling(userId);
  return quote({
    skuId,
    multiples,
    firstPayment: !billing.first_paid_at,
    followsVerified,
    discountAlreadyUsed: billing.follow_discount_used,
    paidCycles: billing.paid_cycles,
    lifetimeCents: billing.lifetime_cents,
  });
}

export async function insertOpenInvoice(input: {
  id: string;
  userId: string;
  quoted: Quote;
  payload: Record<string, unknown>;
  externalId: string;
  expiresAt: Date | null;
}): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into desk_invoices (
       id, user_id, rail, sku, threads, amount_cents, discount_cents,
       status, external_id, payload, expires_at
     ) values ($1,$2,'plisio',$3,$4,$5,$6,'pending',$7,$8,$9)`,
    [
      input.id,
      input.userId,
      input.quoted.sku.id,
      input.quoted.threads,
      input.quoted.amountCents,
      input.quoted.discountCents,
      input.externalId,
      JSON.stringify(input.payload),
      input.expiresAt,
    ],
  );
}

export async function invoiceForUser(userId: string, invoiceId: string): Promise<InvoiceRow | null> {
  const sql = await getSql();
  const rows = await sql.query<InvoiceRow>(
    `select id, user_id, rail, sku, threads, amount_cents, discount_cents,
            status, external_id, payload, created_at, paid_at, expires_at
       from desk_invoices where id = $1 and user_id = $2 limit 1`,
    [invoiceId, userId],
  );
  return rows[0] ?? null;
}

export async function invoiceById(invoiceId: string): Promise<InvoiceRow | null> {
  const sql = await getSql();
  const rows = await sql.query<InvoiceRow>(
    `select id, user_id, rail, sku, threads, amount_cents, discount_cents,
            status, external_id, payload, created_at, paid_at, expires_at
       from desk_invoices where id = $1 limit 1`,
    [invoiceId],
  );
  return rows[0] ?? null;
}

export async function availableThreads(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ n: number }>(
    `select coalesce(sum(threads_remaining), 0)::int as n
       from desk_credit_lots
      where user_id = $1
        and threads_remaining > 0
        and (expires_at is null or expires_at > now())`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

function lotKind(skuKind: string): "refill" | "topup" {
  return skuKind === "refill" ? "refill" : "topup";
}

export async function applyPaidWebhook(input: {
  raw: string;
  payload: Record<string, unknown>;
  signatureOk: boolean;
  status: string;
  invoiceId: string | null;
  externalId: string;
  paidAmountCents: number;
}): Promise<{ ok: boolean; minted: number; reason?: string; replay?: boolean }> {
  const sql = await getSql();
  const rawSha = createHash("sha256").update(input.raw, "utf8").digest("hex");
  const eventId = newId("whe");

  try {
    await sql.query(
      `insert into desk_webhook_events (id, rail, external_id, invoice_id, raw_sha256, accepted, reason)
       values ($1,'plisio',$2,$3,$4,false,'received')`,
      [eventId, input.externalId, input.invoiceId, rawSha],
    );
  } catch {
    return { ok: true, minted: 0, replay: true, reason: "replay" };
  }

  if (!input.invoiceId) {
    await sql.query(`update desk_webhook_events set reason = 'unbound' where id = $1`, [eventId]);
    return { ok: false, minted: 0, reason: "unbound" };
  }

  const invoice = await invoiceById(input.invoiceId);
  if (!invoice) {
    await sql.query(`update desk_webhook_events set reason = 'unbound' where id = $1`, [eventId]);
    return { ok: false, minted: 0, reason: "unbound" };
  }

  const expired =
    invoice.status === "expired" ||
    (invoice.expires_at != null && Date.parse(String(invoice.expires_at)) <= Date.now());

  const verdict = acceptPaid({
    signatureOk: input.signatureOk,
    status: input.status,
    invoiceAmountCents: invoice.amount_cents,
    paidAmountCents: input.paidAmountCents,
    alreadyMinted: invoice.status === "paid",
    deskUserId: invoice.user_id,
    expired,
  });

  if (!verdict.accept) {
    if (verdict.reason === "underpay") {
      await sql.query(`update desk_invoices set status = 'underpay' where id = $1 and status = 'pending'`, [
        invoice.id,
      ]);
    }
    if (verdict.reason === "expired") {
      await sql.query(`update desk_invoices set status = 'expired' where id = $1 and status = 'pending'`, [
        invoice.id,
      ]);
    }
    await sql.query(`update desk_webhook_events set reason = $1 where id = $2`, [verdict.reason, eventId]);
    return { ok: false, minted: 0, reason: verdict.reason };
  }

  if (verdict.replay || invoice.status === "paid") {
    await sql.query(`update desk_webhook_events set accepted = true, reason = 'replay' where id = $1`, [
      eventId,
    ]);
    return { ok: true, minted: 0, replay: true };
  }

  const claimed = await sql.query<{ id: string }>(
    `update desk_invoices
        set status = 'paid', paid_at = now(), external_id = coalesce(external_id, $2)
      where id = $1 and status = 'pending'
      returning id`,
    [invoice.id, input.externalId],
  );
  if (!claimed[0]) {
    await sql.query(`update desk_webhook_events set accepted = true, reason = 'replay' where id = $1`, [
      eventId,
    ]);
    return { ok: true, minted: 0, replay: true };
  }

  const skuKind = invoice.sku.startsWith("plan:") ? "refill" : "topup";
  const expires =
    skuKind === "refill" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;
  const lotId = newId("lot");
  await sql.query(
    `insert into desk_credit_lots (
       id, user_id, kind, threads_original, threads_remaining, expires_at, invoice_id
     ) values ($1,$2,$3,$4,$4,$5,$6)`,
    [lotId, invoice.user_id, lotKind(skuKind), invoice.threads, expires, invoice.id],
  );

  await sql.query(
    `insert into desk_billing (user_id, personas_cap, paid_cycles, lifetime_cents, first_paid_at, follow_discount_used)
     values ($1, 1, 0, 0, now(), false)
     on conflict (user_id) do update set
       lifetime_cents = desk_billing.lifetime_cents + $2,
       paid_cycles = desk_billing.paid_cycles + $3,
       first_paid_at = coalesce(desk_billing.first_paid_at, now()),
       follow_discount_used = desk_billing.follow_discount_used or $4`,
    [invoice.user_id, invoice.amount_cents, skuKind === "refill" ? 1 : 0, invoice.discount_cents > 0],
  );

  await sql.query(`update desk_webhook_events set accepted = true, reason = 'paid', invoice_id = $2 where id = $1`, [
    eventId,
    invoice.id,
  ]);
  return { ok: true, minted: invoice.threads };
}
