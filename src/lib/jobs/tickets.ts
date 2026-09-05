import { newId } from "../agent/ids.ts";

type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function isUniqueViolation(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  const msg = err instanceof Error ? err.message : "";
  return code === "23505" || /unique|duplicate/i.test(msg);
}

const SLA_BODY = "PAID offer not delivered in 10 minutes.";

/**
 * One SLA ticket per paid offer. Retried fulfillment jobs skip if the ticket
 * already exists; a unique index is the race fence.
 */
export async function ensureSlaTicket(
  sql: Sql,
  row: { userId: string; threadId: string; offerId: string; body?: string },
): Promise<{ inserted: boolean; id: string | null }> {
  const existing = await sql.query<{ id: string }>(
    `select id from agent_tickets
      where offer_id = $1 and kind = 'sla'
      limit 1`,
    [row.offerId],
  );
  if (existing[0]) return { inserted: false, id: existing[0].id };

  const id = newId("tix");
  try {
    await sql.query(
      `insert into agent_tickets (id, user_id, thread_id, offer_id, kind, body)
       values ($1,$2,$3,$4,'sla',$5)`,
      [id, row.userId, row.threadId, row.offerId, row.body ?? SLA_BODY],
    );
    return { inserted: true, id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await sql.query<{ id: string }>(
        `select id from agent_tickets where offer_id = $1 and kind = 'sla' limit 1`,
        [row.offerId],
      );
      return { inserted: false, id: again[0]?.id ?? null };
    }
    throw err;
  }
}
