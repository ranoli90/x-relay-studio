import { getSql } from "@/lib/db";
import { ensureSeed } from "./seed.server.ts";
import { processInbound } from "./brain.server.ts";
import { newId } from "./ids.ts";

/**
 * Drain Telegram messages marked ai_status=queued into the conversation brain.
 * Ingest stays <200ms; this is the worker.
 */
export async function drainQueuedTelegram(limit = 8): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    user_id: string;
    chat_id: string;
    body: string;
    author_name: string;
  }>(
    `select id, user_id, chat_id, body, author_name from telegram_messages
      where ai_status = 'queued' and from_self = false
      order by created_at asc
      limit $1`,
    [limit],
  );
  let n = 0;
  for (const row of rows) {
    try {
      const personaId = await ensureSeed(row.user_id);
      let fan = (
        await sql.query<{ id: string }>(
          `select id from agent_fans where user_id = $1 and tg_peer_id = $2 limit 1`,
          [row.user_id, row.chat_id],
        )
      )[0];
      if (!fan) {
        const fanId = newId("fan");
        const threadId = newId("thr");
        await sql.query(
          `insert into agent_fans
            (id, user_id, persona_id, display_name, handle, source, archetype, tg_peer_id)
           values ($1,$2,$3,$4,null,'telegram','new',$5)`,
          [fanId, row.user_id, personaId, row.author_name || "Telegram", row.chat_id],
        );
        await sql.query(
          `insert into agent_threads (id, user_id, persona_id, fan_id, workflow, state)
           values ($1,$2,$3,$4,'W1_INGEST','open')`,
          [threadId, row.user_id, personaId, fanId],
        );
        fan = { id: fanId };
      }
      const thread = (
        await sql.query<{ id: string }>(
          `select id from agent_threads where fan_id = $1 limit 1`,
          [fan.id],
        )
      )[0];
      if (!thread) continue;
      await processInbound({
        userId: row.user_id,
        threadId: thread.id,
        fanId: fan.id,
        text: row.body,
        source: "telegram",
        idempotencyKey: `tg:${row.id}`,
      });
      await sql.query(`update telegram_messages set ai_status = 'held' where id = $1`, [row.id]);
      n += 1;
    } catch {
      await sql.query(`update telegram_messages set ai_status = 'held' where id = $1`, [row.id]);
    }
  }
  return n;
}
