import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { newId } from "./ids.ts";

type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const FanPaySchema = z.object({
  offerId: z.string().trim().min(8).max(80),
  rail: z.string().trim().min(2).max(40),
  externalId: z.string().trim().min(4).max(120),
  amountCents: z.coerce.number().int().positive().max(100_000_000),
});

export type MarkPaidResult =
  | { ok: true; replay: boolean; offerId: string; threadId: string }
  | { ok: false; reason: "not_found" | "amount_mismatch" | "wrong_status" | "expired" | "conflict" };

type OfferLock = {
  id: string;
  user_id: string;
  thread_id: string;
  fan_id: string;
  status: string;
  price_cents: number;
  amount_minor?: number | null;
  expires_at?: string | Date | null;
};

function isUniqueViolation(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  const msg = err instanceof Error ? err.message : "";
  return code === "23505" || /unique|duplicate/i.test(msg);
}

function isPayableStatus(status: string): boolean {
  return status === "sent" || status === "accepted" || status === "awaiting_pay";
}

async function lockOffer(sql: Sql, offerId: string): Promise<OfferLock | undefined> {
  try {
    return (
      await sql.query<OfferLock>(
        `select id, user_id, thread_id, fan_id, status, price_cents,
                coalesce(amount_minor, price_cents) as amount_minor, expires_at
           from agent_offers where id = $1
           for update`,
        [offerId],
      )
    )[0];
  } catch {
    return (
      await sql.query<OfferLock>(
        `select id, user_id, thread_id, fan_id, status, price_cents
           from agent_offers where id = $1
           for update`,
        [offerId],
      )
    )[0];
  }
}

/**
 * Fan catalog webhook auth. `PAYMENTS_WEBHOOK_SECRET` only — never `CRON_SECRET`.
 */
export function fanWebhookAuthorized(
  authorizationHeader: string | null,
  paymentsWebhookSecret: string | undefined | null,
): boolean {
  const secret = paymentsWebhookSecret?.trim() ?? "";
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authorizationHeader ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Fan → operator settlement. Amount and ownership come from the locked offer row,
 * not the webhook payload. Replay of the same external id is a no-op.
 *
 * `userId` scopes simulatePay / operator calls. Pass `null` for the signed fan
 * webhook so the owner is taken from the locked offer.
 */
export async function applyMarkPaid(
  sql: Sql,
  userId: string | null,
  input: { offerId: string; rail: string; externalId: string; amountCents: number },
): Promise<MarkPaidResult> {
  const offer = await lockOffer(sql, input.offerId);
  if (!offer) return { ok: false, reason: "not_found" };
  if (userId != null && offer.user_id !== userId) return { ok: false, reason: "not_found" };

  const ownerId = offer.user_id;
  const expected = Number(offer.amount_minor ?? offer.price_cents);

  if (offer.status === "paid" || offer.status === "delivered") {
    return { ok: true, replay: true, offerId: offer.id, threadId: offer.thread_id };
  }
  if (offer.status === "draft" || offer.status === "held" || offer.status === "canceled" || offer.status === "declined") {
    return { ok: false, reason: "wrong_status" };
  }
  if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (!isPayableStatus(offer.status) && offer.status !== "sent") {
    return { ok: false, reason: "wrong_status" };
  }
  if (expected !== input.amountCents) return { ok: false, reason: "amount_mismatch" };

  try {
    await sql.query("savepoint pay_insert").catch(() => undefined);
    await sql.query(
      `insert into agent_payments (id, user_id, offer_id, rail, amount_cents, status, external_id, paid_at)
       values ($1,$2,$3,$4,$5,'paid',$6,now())`,
      [newId("pay"), ownerId, offer.id, input.rail, expected, input.externalId],
    );
  } catch (err) {
    await sql.query("rollback to savepoint pay_insert").catch(() => undefined);
    if (!isUniqueViolation(err)) throw err;
    const mine = (
      await sql.query<{ offer_id: string }>(
        `select offer_id from agent_payments
          where offer_id = $1
             or (rail = $2 and external_id = $3)
          limit 8`,
        [offer.id, input.rail, input.externalId],
      )
    ).some((row) => row.offer_id === offer.id);
    if (!mine) return { ok: false, reason: "conflict" };
  }

  const claimed = await sql.query<{ id: string; thread_id: string; fan_id: string }>(
    `update agent_offers
        set status = 'paid', paid_at = now()
      where id = $1 and user_id = $2 and status <> 'paid' and status <> 'delivered'
      returning id, thread_id, fan_id`,
    [offer.id, ownerId],
  );
  if (!claimed[0]) {
    return { ok: true, replay: true, offerId: offer.id, threadId: offer.thread_id };
  }

  await sql.query(
    `update agent_fans set lifetime_cents = lifetime_cents + $1, trust = least(100, trust + 8)
      where id = $2 and user_id = $3`,
    [expected, claimed[0].fan_id, ownerId],
  );
  await sql.query(
    `update agent_threads set workflow = 'W9_FULFILL', state = 'fulfilling'
      where id = $1 and user_id = $2`,
    [claimed[0].thread_id, ownerId],
  );
  const runAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await sql.query(
    `insert into agent_jobs (id, user_id, thread_id, kind, run_at, payload, status)
     values ($1,$2,$3,'fulfillment',$4,$5,'pending')`,
    [newId("job"), ownerId, claimed[0].thread_id, runAt, JSON.stringify({ offerId: offer.id })],
  );
  return { ok: true, replay: false, offerId: offer.id, threadId: claimed[0].thread_id };
}
