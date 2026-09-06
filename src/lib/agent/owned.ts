import { z } from "zod";

type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const Id = z.string().trim().min(8).max(80);

export const OfferIdSchema = z.object({
  offerId: Id,
});

export const ThreadIdSchema = z.object({
  threadId: Id,
});

export const MessageIdSchema = z.object({
  messageId: Id,
  body: z.string().trim().max(2000).optional(),
});

export const SimulateInboundSchema = z.object({
  threadId: Id.optional(),
  text: z.string().max(2000).optional(),
  scenario: z.enum([
    "quick_buy",
    "gfe",
    "burned",
    "real",
    "meetup",
    "injection",
    "minor",
  ]).optional(),
});

export const ThreadToggleSchema = z.object({
  threadId: Id,
  on: z.boolean(),
});

export const OperatorSendSchema = z.object({
  threadId: Id,
  body: z.string().trim().min(1).max(2000),
});

export type MarkDeliveredResult =
  | { ok: true; offerId: string; threadId: string; attested: true }
  | { ok: false; reason: "not_found" };

/**
 * Operator attestation that a *paid* offer was handed over.
 * This is not provider-confirmed delivery.
 *
 * Every downstream id is taken from the owned UPDATE … RETURNING row.
 * An absent or unowned offer yields no writes.
 */
export async function applyMarkDelivered(
  sql: Sql,
  userId: string,
  offerId: string,
): Promise<MarkDeliveredResult> {
  const updated = await sql.query<{ id: string; thread_id: string }>(
    `update agent_offers
        set status = 'delivered', delivered_at = now()
      where id = $1 and user_id = $2 and status = 'paid'
      returning id, thread_id`,
    [offerId, userId],
  );
  const offer = updated[0];
  if (!offer) return { ok: false, reason: "not_found" };

  await sql.query(
    `update agent_threads
        set workflow = 'W10_AFTERCARE', state = 'aftercare'
      where id = $1 and user_id = $2`,
    [offer.thread_id, userId],
  );
  return { ok: true, offerId: offer.id, threadId: offer.thread_id, attested: true };
}

/** Approve a local draft. Never labels it sent — there is no transport here. */
export async function applyApproveDraft(
  sql: Sql,
  userId: string,
  messageId: string,
  bodyOverride?: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const row = (
    await sql.query<{ id: string; thread_id: string; body: string }>(
      `select id, thread_id, body from agent_messages
        where id = $1 and user_id = $2 and role = 'draft' and status <> 'dropped'`,
      [messageId, userId],
    )
  )[0];
  if (!row) return { ok: false, reason: "not_found" };
  const body = (bodyOverride ?? row.body).trim();
  if (!body) return { ok: false, reason: "not_found" };
  await sql.query(
    `update agent_messages
        set status = 'approved', body = $1, auto = false
      where id = $2 and user_id = $3`,
    [body, row.id, userId],
  );
  await sql.query(
    `update agent_threads set state = 'open', unread = 0
      where id = $1 and user_id = $2`,
    [row.thread_id, userId],
  );
  return { ok: true };
}
