import { getSql } from "@/lib/db";
import { ensureSeed } from "./seed.server.ts";
import { processInbound } from "./brain.server.ts";
import { newId } from "./ids.ts";
import { isNonProcessableInbound, redactForModel } from "./consent.ts";
import { availableThreads, burnThreadIfBillable } from "@/lib/billing/ledger.server.ts";

/**
 * Drain Telegram messages marked ai_status=queued into the conversation brain.
 * Watching is not consent. automation_armed is the processing gate.
 * Failures stay retry_wait — they are not "held" as if the operator chose that.
 */
export async function drainQueuedTelegram(limit = 8, userIds?: string[]): Promise<number> {
  if (userIds && userIds.length === 0) return 0;
  const sql = await getSql();
  const cap = Math.max(1, Math.min(Math.floor(limit) || 8, 32));
  const rows = userIds
    ? await sql.query<{
        id: string;
        user_id: string;
        chat_id: string;
        body: string;
        author_name: string;
        automation_armed: boolean | null;
        auth_dead: boolean | null;
      }>(
        `select m.id, m.user_id, m.chat_id, m.body, m.author_name,
                s.automation_armed, s.auth_dead
           from telegram_messages m
           left join telegram_user_sessions s on s.user_id = m.user_id
          where m.ai_status = 'queued' and m.from_self = false
            and m.user_id = any($2::text[])
          order by m.created_at asc
          limit $1`,
        [cap, userIds],
      )
    : await sql.query<{
        id: string;
        user_id: string;
        chat_id: string;
        body: string;
        author_name: string;
        automation_armed: boolean | null;
        auth_dead: boolean | null;
      }>(
        `select m.id, m.user_id, m.chat_id, m.body, m.author_name,
                s.automation_armed, s.auth_dead
           from telegram_messages m
           left join telegram_user_sessions s on s.user_id = m.user_id
          where m.ai_status = 'queued' and m.from_self = false
          order by m.created_at asc
          limit $1`,
        [cap],
      );

  let n = 0;
  for (const row of rows) {
    try {
      if (!row.automation_armed || row.auth_dead) {
        await sql.query(`update telegram_messages set ai_status = 'held' where id = $1`, [row.id]);
        continue;
      }
      if (isNonProcessableInbound(row.body, row.author_name)) {
        await sql.query(`update telegram_messages set ai_status = 'suppressed' where id = $1`, [
          row.id,
        ]);
        continue;
      }
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
          `select id from agent_threads where fan_id = $1 and user_id = $2 limit 1`,
          [fan.id, row.user_id],
        )
      )[0];
      if (!thread) continue;
      const result = await processInbound({
        userId: row.user_id,
        threadId: thread.id,
        fanId: fan.id,
        text: redactForModel(row.body),
        source: "telegram",
        idempotencyKey: `tg:${row.id}`,
      });
      const credits = await availableThreads(row.user_id);
      await burnThreadIfBillable(row.user_id, thread.id, {
        safetyKilled: result.killed,
        parked: false,
        takeoverNoModel: false,
        alreadyBilled: false,
        aftercare: false,
        failedModel: false,
        humanOnly: !result.auto,
        availableCredits: credits,
      });
      await sql.query(`update telegram_messages set ai_status = $1 where id = $2`, [
        result.auto ? "outbound" : "held",
        row.id,
      ]);
      n += 1;
    } catch {
      await sql.query(
        `update telegram_messages set ai_status = 'retry_wait' where id = $1 and ai_status = 'queued'`,
        [row.id],
      );
    }
  }
  return n;
}
