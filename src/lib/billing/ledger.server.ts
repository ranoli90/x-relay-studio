import { getSql, withTransaction } from "@/lib/db";
import { quote, type Quote } from "./catalog.ts";
import {
  decideBurn,
  takeOne,
  type BurnDecision,
  type BurnEvent,
  type CreditHold,
  type Lot,
} from "./credits.ts";
import { followDiscountHeld, verifyFollowMembership } from "./follows.ts";
import { applyPaidWebhookOn, type InvoiceRow } from "./settle.ts";

export type { InvoiceRow };

export type BillingRow = {
  user_id: string;
  personas_cap: number;
  paid_cycles: number;
  lifetime_cents: number;
  first_paid_at: string | Date | null;
  follow_discount_used: boolean;
};

function isUniqueViolation(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  const msg = err instanceof Error ? err.message : "";
  return code === "23505" || /unique|duplicate/i.test(msg);
}

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

export async function deskFollowsVerified(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ network: string }>(
    `select network from desk_follows
      where user_id = $1 and verified_at is not null`,
    [userId],
  );
  const nets = new Set(rows.map((r) => r.network));
  return nets.has("telegram") && nets.has("discord");
}

export async function followIdsForUser(
  userId: string,
): Promise<{ telegram: string | null; discord: string | null }> {
  const sql = await getSql();
  const rows = await sql.query<{ network: string; external_id: string }>(
    `select network, external_id from desk_follows
      where user_id = $1 and verified_at is not null`,
    [userId],
  );
  let telegram = rows.find((r) => r.network === "telegram")?.external_id ?? null;
  const discord = rows.find((r) => r.network === "discord")?.external_id ?? null;
  if (!telegram) {
    try {
      const acc = await sql.query<{ telegram_user_id: string | number }>(
        `select telegram_user_id from telegram_accounts where user_id = $1 limit 1`,
        [userId],
      );
      if (acc[0]) telegram = String(acc[0].telegram_user_id);
    } catch {
      /* isolated billing fixtures may omit telegram_accounts */
    }
  }
  return { telegram, discord };
}

/** Live Telegram + Discord membership. Client flags are ignored. */
export async function verifyDeskFollowsLive(userId: string): Promise<boolean> {
  const ids = await followIdsForUser(userId);
  const result = await verifyFollowMembership({
    telegramUserId: ids.telegram,
    discordUserId: ids.discord,
  });
  return result.verified;
}

export async function recordFollow(input: {
  userId: string;
  network: "telegram" | "discord";
  externalId: string;
  verified: boolean;
}): Promise<void> {
  if (!input.verified || !input.externalId) return;
  const sql = await getSql();
  const existing = await sql.query<{ user_id: string }>(
    `select user_id from desk_follows where network = $1 and external_id = $2 limit 1`,
    [input.network, input.externalId],
  );
  if (existing[0] && existing[0].user_id !== input.userId) return;
  try {
    await sql.query(
      `insert into desk_follows (user_id, network, external_id, verified_at, last_check_at)
       values ($1,$2,$3,now(),now())
       on conflict (user_id, network) do update set
         external_id = excluded.external_id,
         verified_at = now(),
         last_check_at = now()`,
      [input.userId, input.network, input.externalId],
    );
  } catch (err) {
    if (isUniqueViolation(err)) return;
    throw err;
  }
}

export async function quoteForUser(userId: string, skuId: string, multiples: number): Promise<Quote> {
  const billing = await loadBilling(userId);
  const followsVerified = await verifyDeskFollowsLive(userId);
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

export async function insertInvoiceIntent(input: {
  id: string;
  userId: string;
  quoted: Quote;
  payload: Record<string, unknown>;
}): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into desk_invoices (
       id, user_id, rail, sku, threads, amount_cents, discount_cents,
       status, payload
     ) values ($1,$2,'plisio',$3,$4,$5,$6,'creating',$7)`,
    [
      input.id,
      input.userId,
      input.quoted.sku.id,
      input.quoted.threads,
      input.quoted.amountCents,
      input.quoted.discountCents,
      JSON.stringify(input.payload),
    ],
  );
}

/**
 * Lock billing, refuse a second $5-off while a discounted invoice is open,
 * then insert the creating invoice in the same transaction.
 */
export async function openInvoiceIntent(input: {
  id: string;
  userId: string;
  skuId: string;
  multiples: number;
  payload: Record<string, unknown>;
  followsLive: boolean;
}): Promise<Quote> {
  return withTransaction(async (sql) => {
    await sql.query(
      `insert into desk_billing (user_id) values ($1)
       on conflict (user_id) do nothing`,
      [input.userId],
    );
    const billing = (
      await sql.query<BillingRow>(
        `select user_id, personas_cap, paid_cycles, lifetime_cents, first_paid_at, follow_discount_used
           from desk_billing where user_id = $1 for update`,
        [input.userId],
      )
    )[0];
    const open = await sql.query<{ discount_cents: number; status: string }>(
      `select discount_cents, status from desk_invoices
        where user_id = $1 and discount_cents > 0
          and status in ('creating', 'pending', 'uncertain')`,
      [input.userId],
    );
    const quoted = quote({
      skuId: input.skuId,
      multiples: input.multiples,
      firstPayment: !billing.first_paid_at,
      followsVerified: input.followsLive,
      discountAlreadyUsed:
        billing.follow_discount_used ||
        followDiscountHeld(open.map((r) => ({ discountCents: r.discount_cents, status: r.status }))),
      paidCycles: billing.paid_cycles,
      lifetimeCents: billing.lifetime_cents,
    });
    await sql.query(
      `insert into desk_invoices (
         id, user_id, rail, sku, threads, amount_cents, discount_cents,
         status, payload
       ) values ($1,$2,'plisio',$3,$4,$5,$6,'creating',$7)`,
      [
        input.id,
        input.userId,
        quoted.sku.id,
        quoted.threads,
        quoted.amountCents,
        quoted.discountCents,
        JSON.stringify(input.payload),
      ],
    );
    return quoted;
  });
}

export async function markInvoiceOpened(input: {
  id: string;
  userId: string;
  externalId: string;
  payload: Record<string, unknown>;
  expiresAt: Date | null;
}): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update desk_invoices
        set status = 'pending',
            external_id = $3,
            payload = $4,
            expires_at = $5
      where id = $1 and user_id = $2 and status in ('creating', 'uncertain')`,
    [input.id, input.userId, input.externalId, JSON.stringify(input.payload), input.expiresAt],
  );
}

export async function markInvoiceUncertain(id: string, userId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update desk_invoices set status = 'uncertain'
      where id = $1 and user_id = $2 and status = 'creating'`,
    [id, userId],
  );
}

export async function markInvoiceCancelled(id: string, userId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update desk_invoices set status = 'cancelled'
      where id = $1 and user_id = $2 and status in ('creating', 'uncertain')`,
    [id, userId],
  );
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

type Sql = Awaited<ReturnType<typeof getSql>>;

export { applyPaidWebhookOn };

export async function applyPaidWebhook(input: {
  raw: string;
  payload: Record<string, unknown>;
  signatureOk: boolean;
  status: string;
  invoiceId: string | null;
  externalId: string;
  paidAmountCents: number;
}): Promise<{ ok: boolean; minted: number; reason?: string; replay?: boolean }> {
  return withTransaction(async (sql) => applyPaidWebhookOn(sql, input));
}

export type ThreadCreditHold = CreditHold & { threadId: string };

async function loadLiveLots(sql: Sql, userId: string): Promise<Lot[]> {
  const rows = await sql.query<{
    id: string;
    kind: "refill" | "topup";
    threads_remaining: number;
    expires_at: string | Date | null;
  }>(
    `select id, kind, threads_remaining, expires_at
       from desk_credit_lots
      where user_id = $1
        and threads_remaining > 0
        and (expires_at is null or expires_at > now())`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    remaining: r.threads_remaining,
    expiresAt: r.expires_at ? String(r.expires_at) : null,
  }));
}

/** Hold one thread credit. Jobs agent commits on success or releases on failure. */
export async function reserveThreadCredit(
  userId: string,
  threadId: string,
  event: BurnEvent,
): Promise<{ hold: ThreadCreditHold | null; decision: BurnDecision }> {
  const gate = decideBurn({ ...event, availableCredits: 1 });
  if (!gate.burn) return { hold: null, decision: gate };

  return withTransaction(async (sql) => {
    const thread = (
      await sql.query<{ id: string; billed_at: string | Date | null }>(
        `select id, billed_at from agent_threads where id = $1 and user_id = $2 for update`,
        [threadId, userId],
      )
    )[0];
    if (!thread) return { hold: null, decision: { burn: false, reason: "no_credits" as const } };
    if (thread.billed_at) return { hold: null, decision: { burn: false, reason: "already_billed" as const } };

    const lots = await loadLiveLots(sql, userId);
    const { took } = takeOne(lots);
    if (!took) return { hold: null, decision: { burn: false, reason: "no_credits" as const } };

    const decremented = await sql.query<{ id: string }>(
      `update desk_credit_lots
          set threads_remaining = threads_remaining - 1
        where id = $1 and user_id = $2 and threads_remaining > 0
        returning id`,
      [took.id, userId],
    );
    if (!decremented[0]) return { hold: null, decision: { burn: false, reason: "no_credits" as const } };

    await sql.query(
      `update agent_threads set billed_at = now() where id = $1 and user_id = $2 and billed_at is null`,
      [threadId, userId],
    );
    return { hold: { threadId, lotId: took.id, units: 1 as const }, decision: { burn: true as const } };
  });
}

export async function releaseThreadCredit(userId: string, hold: ThreadCreditHold): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update desk_credit_lots
        set threads_remaining = threads_remaining + $3
      where id = $1 and user_id = $2`,
    [hold.lotId, userId, hold.units],
  );
  await sql.query(`update agent_threads set billed_at = null where id = $1 and user_id = $2`, [
    hold.threadId,
    userId,
  ]);
}

export async function commitThreadCredit(
  _userId: string,
  _hold: ThreadCreditHold,
): Promise<{ burn: true }> {
  return { burn: true };
}

export async function burnThreadIfBillable(
  userId: string,
  threadId: string,
  event: BurnEvent,
): Promise<BurnDecision> {
  const reserved = await reserveThreadCredit(userId, threadId, event);
  if (!reserved.hold) return reserved.decision;
  await commitThreadCredit(userId, reserved.hold);
  return { burn: true };
}
