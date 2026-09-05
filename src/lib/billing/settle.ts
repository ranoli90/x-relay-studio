import { createHash } from "node:crypto";
import { newId } from "../agent/ids.ts";
import { acceptPaid } from "./verify.ts";

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

type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function isUniqueViolation(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  const msg = err instanceof Error ? err.message : "";
  return code === "23505" || /unique|duplicate/i.test(msg);
}

function lotKind(skuKind: string): "refill" | "topup" {
  return skuKind === "refill" ? "refill" : "topup";
}

async function settlePaidInvoice(
  sql: Sql,
  invoice: InvoiceRow,
  externalId: string,
): Promise<{ minted: number; replay: boolean }> {
  const claimed = await sql.query<{ id: string }>(
    `update desk_invoices
        set status = 'paid', paid_at = now(), external_id = coalesce(external_id, $2)
      where id = $1 and status in ('pending', 'creating', 'uncertain', 'underpay')
      returning id`,
    [invoice.id, externalId],
  );
  if (!claimed[0]) return { minted: 0, replay: true };

  const skuKind = invoice.sku.startsWith("plan:") ? "refill" : "topup";
  const expires =
    skuKind === "refill" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;
  const lotId = newId("lot");
  try {
    await sql.query(
      `insert into desk_credit_lots (
         id, user_id, kind, threads_original, threads_remaining, expires_at, invoice_id
       ) values ($1,$2,$3,$4,$4,$5,$6)`,
      [lotId, invoice.user_id, lotKind(skuKind), invoice.threads, expires, invoice.id],
    );
  } catch (err) {
    if (isUniqueViolation(err)) return { minted: 0, replay: true };
    throw err;
  }

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
  return { minted: invoice.threads, replay: false };
}

export async function applyPaidWebhookOn(
  sql: Sql,
  input: {
    raw: string;
    payload: Record<string, unknown>;
    signatureOk: boolean;
    status: string;
    invoiceId: string | null;
    externalId: string;
    paidAmountCents: number;
  },
): Promise<{ ok: boolean; minted: number; reason?: string; replay?: boolean }> {
  const rawSha = createHash("sha256").update(input.raw, "utf8").digest("hex");
  const eventId = newId("whe");
  let id = eventId;
  try {
    await sql.query(
      `insert into desk_webhook_events (id, rail, external_id, invoice_id, raw_sha256, accepted, reason, status)
       values ($1,'plisio',$2,$3,$4,false,'received','received')`,
      [eventId, input.externalId, input.invoiceId, rawSha],
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = (
      await sql.query<{ id: string; accepted: boolean; reason: string | null }>(
        `select id, accepted, reason from desk_webhook_events
          where rail = 'plisio' and raw_sha256 = $1 limit 1`,
        [rawSha],
      )
    )[0];
    if (!existing) throw err;
    if (existing.accepted) {
      return { ok: true, minted: 0, replay: true, reason: "replay" };
    }
    id = existing.id;
  }

  if (!input.signatureOk) {
    await sql.query(
      `update desk_webhook_events set reason = 'bad_signature', status = 'rejected' where id = $1`,
      [id],
    );
    return { ok: false, minted: 0, reason: "bad_signature" };
  }

  if (!input.invoiceId) {
    await sql.query(
      `update desk_webhook_events set reason = 'unbound', status = 'rejected' where id = $1`,
      [id],
    );
    return { ok: false, minted: 0, reason: "unbound" };
  }

  const invoiceRows = await sql.query<InvoiceRow>(
    `select id, user_id, rail, sku, threads, amount_cents, discount_cents,
            status, external_id, payload, created_at, paid_at, expires_at
       from desk_invoices where id = $1 limit 1 for update`,
    [input.invoiceId],
  );
  const invoice = invoiceRows[0];
  if (!invoice) {
    await sql.query(
      `update desk_webhook_events set reason = 'unbound', status = 'rejected' where id = $1`,
      [id],
    );
    return { ok: false, minted: 0, reason: "unbound" };
  }

  const expired =
    invoice.status === "expired" ||
    invoice.status === "cancelled" ||
    (invoice.expires_at != null && Date.parse(String(invoice.expires_at)) <= Date.now());

  const verdict = acceptPaid({
    signatureOk: true,
    status: input.status,
    invoiceAmountCents: invoice.amount_cents,
    paidAmountCents: input.paidAmountCents,
    alreadyMinted: invoice.status === "paid",
    deskUserId: invoice.user_id,
    expired,
  });

  if (!verdict.accept) {
    if (verdict.reason === "underpay") {
      await sql.query(
        `update desk_invoices set status = 'underpay' where id = $1 and status in ('pending', 'creating', 'uncertain')`,
        [invoice.id],
      );
    }
    if (verdict.reason === "expired") {
      await sql.query(
        `update desk_invoices set status = 'expired' where id = $1 and status in ('pending', 'creating', 'uncertain', 'underpay')`,
        [invoice.id],
      );
    }
    if (verdict.reason === "uncertain") {
      await sql.query(
        `update desk_invoices set status = 'uncertain' where id = $1 and status in ('pending', 'creating')`,
        [invoice.id],
      );
    }
    await sql.query(
      `update desk_webhook_events set reason = $1, status = 'rejected' where id = $2`,
      [verdict.reason, id],
    );
    return { ok: false, minted: 0, reason: verdict.reason };
  }

  const settled = await settlePaidInvoice(sql, invoice, input.externalId);
  await sql.query(
    `update desk_webhook_events
        set accepted = true,
            reason = $2,
            status = 'accepted',
            invoice_id = $3
      where id = $1`,
    [id, settled.replay ? "replay" : "paid", invoice.id],
  );
  return { ok: true, minted: settled.minted, replay: settled.replay };
}
