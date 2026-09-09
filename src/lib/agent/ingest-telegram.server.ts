import { getSql, withTransaction } from "@/lib/db";
import { ensureSeed } from "./seed.server.ts";

import { processInbound } from "./brain.server.ts";
import { newId } from "./ids.ts";
import { isNonProcessableInbound, redactForModel } from "./consent.ts";
import { availableThreads, burnThreadIfBillable } from "@/lib/billing/ledger.server.ts";
import { classifyInboundAiStatus, retryBackoffMs } from "@/lib/telegram/watch-status.ts";
import {
  decideIngressCreditBurn,
  decideManualOutboundMirror,
  type AgentTransportRow,
} from "../conversation/mirror.ts";

const MAX_INGRESS_ATTEMPTS = 8;

type DrainRow = {
  id: string;
  user_id: string;
  chat_id: string;
  body: string;
  author_name: string;
  created_at: string | Date | null;
  ai_status: string;
  ai_attempt_count: number | null;
  automation_armed: boolean | null;
  auth_dead: boolean | null;
  emergency_stop: boolean | null;
  activation_watermark: string | Date | null;
  persona_emergency_stop: boolean | null;
  automation_mode: string | null;
  processing_permission?: boolean | null;
};

type Sql = Awaited<ReturnType<typeof getSql>>;

const CLAIM_LEASE_MS = 2 * 60_000;

async function locateOrCreateFanThread(
  tx: Sql,
  opts: { userId: string; chatId: string; personaId: string; displayName: string },
): Promise<{ fanId: string; threadId: string | null }> {
  const existingFan = (
    await tx.query<{ id: string }>(
      `select id from agent_fans where user_id = $1 and tg_peer_id = $2 limit 1`,
      [opts.userId, opts.chatId],
    )
  )[0];
  let fanId = existingFan?.id;
  if (!fanId) {
    fanId = newId("fan");
    const inserted = await tx.query<{ id: string }>(
      `insert into agent_fans
          (id, user_id, persona_id, display_name, handle, source, archetype, tg_peer_id)
         values ($1,$2,$3,$4,null,'telegram','new',$5)
         on conflict (user_id, tg_peer_id) where tg_peer_id is not null do nothing
         returning id`,
      [fanId, opts.userId, opts.personaId, opts.displayName, opts.chatId],
    );
    if (inserted[0]?.id) {
      fanId = inserted[0].id;
    } else {
      const raced = (
        await tx.query<{ id: string }>(
          `select id from agent_fans where user_id = $1 and tg_peer_id = $2 limit 1`,
          [opts.userId, opts.chatId],
        )
      )[0];
      if (!raced) throw new Error("fan_create_failed");
      fanId = raced.id;
    }
  }

  const existingThread = (
    await tx.query<{ id: string }>(
      `select id from agent_threads where user_id = $1 and fan_id = $2 limit 1`,
      [opts.userId, fanId],
    )
  )[0];
  if (existingThread) return { fanId, threadId: existingThread.id };
  const threadId = newId("thr");
  const inserted = await tx.query<{ id: string }>(
    `insert into agent_threads (id, user_id, persona_id, fan_id, workflow, state)
       values ($1,$2,$3,$4,'W1_INGEST','open')
       on conflict (user_id, fan_id) do nothing
       returning id`,
    [threadId, opts.userId, opts.personaId, fanId],
  );
  if (inserted[0]?.id) return { fanId, threadId: inserted[0].id };
  const raced = (
    await tx.query<{ id: string }>(
      `select id from agent_threads where user_id = $1 and fan_id = $2 limit 1`,
      [opts.userId, fanId],
    )
  )[0];
  return { fanId, threadId: raced?.id ?? null };

}

/**
 * Drain Telegram messages marked queued / due retry_wait into the conversation
 * brain. Historical imports are not actionable. Claims are per-row CAS.
 */
export async function drainQueuedTelegram(limit = 8, userIds?: string[]): Promise<number> {
  if (userIds && userIds.length === 0) return 0;
  const sql = await getSql();
  const cap = Math.max(1, Math.min(Math.floor(limit) || 8, 32));

  const candidates = await selectDueIngress(sql, cap, userIds);
  let n = 0;
  for (const row of candidates) {
    const claimed = await claimIngressRow(sql, row.id);
    if (!claimed) continue;
    try {
      const status = await processClaimedRow(sql, { ...row, ...claimed });
      await sql.query(
        `update telegram_messages
            set ai_status = $1, claim_owner = null, claim_expires_at = null
          where id = $2 and claim_owner = $3 and ai_status = 'processing'`,
        [status, row.id, claimed.claim_owner],
      );
      n += 1;
    } catch {
      const attempts = Number(row.ai_attempt_count ?? 0) + 1;
      if (attempts >= MAX_INGRESS_ATTEMPTS) {
        await sql.query(
          `update telegram_messages
              set ai_status = 'held', claim_owner = null, claim_expires_at = null
            where id = $1 and claim_owner = $2 and ai_status = 'processing'`,
          [row.id, claimed.claim_owner],
        );
      } else {
        const wait = new Date(Date.now() + retryBackoffMs(attempts)).toISOString();
        await sql.query(
          `update telegram_messages
              set ai_status = 'retry_wait', next_attempt_at = $2, claim_owner = null, claim_expires_at = null
            where id = $1 and claim_owner = $3 and ai_status = 'processing'`,
          [row.id, wait, claimed.claim_owner],
        );
      }
    }

  }
  return n;
}

async function selectDueIngress(
  sql: Sql,
  cap: number,
  userIds?: string[],
): Promise<DrainRow[]> {
  const scoped = Boolean(userIds);
  const params: unknown[] = scoped ? [cap, userIds] : [cap];
  const userClause = scoped ? "and m.user_id = any($2::text[])" : "";
  return sql.query<DrainRow>(
    `select m.id, m.user_id, m.chat_id, m.body, m.author_name, m.created_at, m.ai_status,
            coalesce(m.ai_attempt_count, 0) as ai_attempt_count,
            s.automation_armed, s.auth_dead,
            coalesce(s.emergency_stop, false) as emergency_stop,
            s.activation_watermark,
            coalesce(p.emergency_stop, false) as persona_emergency_stop,
            coalesce(p.automation_mode, 'approved_auto') as automation_mode,
            coalesce(p.processing_permission, true) as processing_permission
       from telegram_messages m
       left join telegram_user_sessions s on s.user_id = m.user_id
       left join agent_personas p on p.user_id = m.user_id
      where m.from_self = false
        and (
          m.ai_status in ('queued', 'retry_wait')
          or (m.ai_status = 'processing' and m.claim_expires_at is not null and m.claim_expires_at < now())
        )
        and (m.next_attempt_at is null or m.next_attempt_at <= now() or m.ai_status = 'processing')

        ${userClause}
      order by m.created_at asc
      limit $1`,
    params,
  );
}

async function claimIngressRow(
  sql: Sql,
  id: string,
): Promise<{ id: string; ai_attempt_count: number; claim_owner: string } | null> {
  const owner = newId("wrk");
  const expires = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
  const rows = await sql.query<{ id: string; ai_attempt_count: number; claim_owner: string }>(
    `update telegram_messages
        set ai_status = 'processing',
            ai_attempt_count = coalesce(ai_attempt_count, 0) + 1,
            claim_owner = $2,
            claim_expires_at = $3
      where id = $1
        and (
          ai_status in ('queued', 'retry_wait')
          or (ai_status = 'processing' and claim_expires_at is not null and claim_expires_at < now())
        )
      returning id, ai_attempt_count, claim_owner`,
    [id, owner, expires],
  );
  return rows[0] ?? null;
}



async function findThreadForChat(
  sql: Sql,
  userId: string,
  chatId: string,
): Promise<{ fanId: string; threadId: string } | null> {
  const fan = (
    await sql.query<{ id: string }>(
      `select id from agent_fans where user_id = $1 and tg_peer_id = $2 limit 1`,
      [userId, chatId],
    )
  )[0];
  if (!fan) return null;
  const thread = (
    await sql.query<{ id: string }>(
      `select id from agent_threads where fan_id = $1 and user_id = $2 limit 1`,
      [fan.id, userId],
    )
  )[0];
  if (!thread) return null;
  return { fanId: fan.id, threadId: thread.id };
}

async function ensureThreadForChat(
  sql: Sql,
  userId: string,
  chatId: string,
  authorName?: string,
): Promise<{ fanId: string; threadId: string } | null> {
  const existing = await findThreadForChat(sql, userId, chatId);
  if (existing) return existing;
  const personaId = await ensureSeed(userId);
  return withTransaction(async (tx) => {
    const located = await locateOrCreateFanThread(tx, {
      userId,
      chatId,
      personaId,
      displayName: authorName || "Telegram",
    });
    if (!located.threadId) return null;
    return { fanId: located.fanId, threadId: located.threadId };
  });
}

/**
 * Watch/import observed a from_self Telegram message. Mirror it into
 * agent_messages unless the transport id is already an agent echo.
 * Never queues inbound and never auto-replies.
 */
export async function persistManualOutboundMirror(opts: {
  userId: string;
  chatId: string;
  body: string;
  telegramMessageId?: number | string | null;
  createdAt?: string | Date | null;
  watermark?: string | Date | null;
  authorName?: string;
}): Promise<"upserted" | "skipped"> {
  const sql = await getSql();
  let existing: AgentTransportRow[] = [];
  const transportHint = opts.telegramMessageId == null ? null : String(opts.telegramMessageId);
  if (transportHint && transportHint !== "0") {
    try {
      existing = await sql
        .query<{ thread_id: string; origin: string | null; transport_message_id: string | null }>(
          `select thread_id, origin, transport_message_id
             from agent_messages
            where user_id = $1 and transport_message_id = $2
            limit 8`,
          [opts.userId, transportHint],
        )
        .then((rows) =>
          rows.map((r) => ({
            userId: opts.userId,
            threadId: r.thread_id,
            transportMessageId: r.transport_message_id,
            origin: r.origin,
          })),
        );
    } catch {
      return "skipped";
    }
  }

  const located = await findThreadForChat(sql, opts.userId, opts.chatId);
  const decision = decideManualOutboundMirror({
    fromSelf: true,
    telegramMessageId: opts.telegramMessageId,
    existing,
    userId: opts.userId,
    threadId: located?.threadId ?? null,
    createdAt: opts.createdAt,
    watermark: opts.watermark,
  });
  if (decision.action !== "upsert") return "skipped";

  const thread = located ?? (await ensureThreadForChat(sql, opts.userId, opts.chatId, opts.authorName));
  if (!thread) return "skipped";

  const dupOnThread = decideManualOutboundMirror({
    fromSelf: true,
    telegramMessageId: opts.telegramMessageId,
    existing,
    userId: opts.userId,
    threadId: thread.threadId,
    createdAt: opts.createdAt,
    watermark: opts.watermark,
  });
  if (dupOnThread.action !== "upsert") return "skipped";

  try {
    const inserted = await sql.query<{ id: string }>(
      `insert into agent_messages
        (id, user_id, thread_id, role, body, auto, status, origin, transport_message_id)
       select $1,$2,$3,'persona',$4,false,'sent',$5,$6
        where not exists (
          select 1 from agent_messages
           where user_id = $2
             and transport_message_id = $6
             and ($3::text is null or thread_id = $3)
        )
       returning id`,
      [
        newId("msg"),
        opts.userId,
        thread.threadId,
        opts.body,
        dupOnThread.origin,
        dupOnThread.transportMessageId,
      ],
    );
    return inserted[0] ? "upserted" : "skipped";
  } catch {
    return "skipped";
  }
}

async function processClaimedRow(
  sql: Sql,
  row: DrainRow,
): Promise<string> {
  if (row.auth_dead) return "held";
  if (row.emergency_stop || row.persona_emergency_stop) return "held";


  const imported = classifyInboundAiStatus({
    fromSelf: false,
    createdAt: row.created_at,
    watermark: row.activation_watermark,
  });
  if (imported === "imported") return "imported";

  if (isNonProcessableInbound(row.body, row.author_name)) return "suppressed";

  const { burstDecision, nextBurstRetryAt } = await import("@/lib/operator/debounce.ts");
  const neighbors = await sql.query<{ created_at: string | Date }>(
    `select created_at from telegram_messages
      where user_id = $1 and chat_id = $2 and from_self = false
        and ai_status in ('queued', 'retry_wait', 'processing')
      order by created_at asc`,
    [row.user_id, row.chat_id],
  );
  if (neighbors.length > 1) {
    const first = new Date(neighbors[0]!.created_at).getTime();
    const last = new Date(neighbors[neighbors.length - 1]!.created_at).getTime();
    const now = Date.now();
    if (
      burstDecision({
        firstInboundAt: first,
        lastInboundAt: last,
        now,
        pendingAfter: neighbors.length - 1,
      }) === "wait"
    ) {
      await sql.query(
        `update telegram_messages set ai_status = 'retry_wait', next_attempt_at = $2
          where id = $1 and ai_status = 'processing'`,
        [row.id, nextBurstRetryAt(now, { firstInboundAt: first }).toISOString()],
      );
      return "retry_wait";
    }
  }

  const credits = await availableThreads(row.user_id);

  const personaId = await ensureSeed(row.user_id);
  const located = await withTransaction(async (tx) =>
    locateOrCreateFanThread(tx, {
      userId: row.user_id,
      chatId: row.chat_id,
      personaId,
      displayName: row.author_name || "Telegram",
    }),
  );
  if (!located.threadId) return "held";
  const fan = { id: located.fanId };
  const thread = { id: located.threadId };

  const result = await processInbound({
    userId: row.user_id,
    threadId: thread.id,
    fanId: fan.id,
    text: redactForModel(row.body),
    source: "telegram",
    idempotencyKey: `tg:${row.id}`,
    forceHold: credits <= 0,
  });
  const burn = decideIngressCreditBurn(result, credits);
  if (burn.shouldBurn) {
    await burnThreadIfBillable(row.user_id, thread.id, burn.event);
  }
  return result.auto ? "outbound" : "held";
}
