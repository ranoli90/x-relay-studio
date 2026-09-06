import { getSql, withTransaction } from "@/lib/db";
import { newId } from "./ids.ts";
import { runSafety, SAFETY_REFUSALS, safetyBlocksGenerate } from "./safety.ts";
import { understandLocal } from "./understand.ts";
import { buildPlan, routeWorkflow } from "./route.ts";
import { writeWithGateway } from "./gateway.server.ts";
import { clockLabel, hourInZone, inWindow } from "./clock.ts";
import { findSku } from "./catalog.ts";
import { goldSummary } from "./eval.ts";
import { ensureSeed } from "./seed.server.ts";
import { applyMarkPaid } from "./pay.ts";
import { claimDueJobs, finalizeJob } from "@/lib/jobs/claim.ts";
import { ensureSlaTicket } from "@/lib/jobs/tickets.ts";
import { decideAutoSend } from "./auto.ts";
import { pickAgentName, pickFromRoster } from "./names.ts";
import { recordActivity } from "./activity.server.ts";
import { tryDispatchAutoSend } from "./dispatch.server.ts";
import { parseAutomationMode, generationOriginForWrite, type GenerationOrigin } from "@/lib/conversation/policy.ts";
import { confirmedTranscript } from "@/lib/conversation/history.ts";
import { resolveIdempotencyHit } from "@/lib/conversation/outbox.ts";
import type {
  Archetype,
  CatalogRow,
  ClockSlot,
  DiaryVoice,
  Source,
  ThreadState,
  UnderstandResult,
  WorkflowId,
} from "./types.ts";

type Sql = Awaited<ReturnType<typeof getSql>>;

function iso(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function colBool(row: object, key: string): boolean {
  const v = (row as Record<string, unknown>)[key];
  return v === true || v === "t" || v === "true";
}

function colText(row: object, key: string, fallback = ""): string {
  const v = (row as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

async function thought(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
  threadId: string,
  kind: string,
  body: string,
) {
  await sql.query(
    `insert into agent_thoughts (id, user_id, thread_id, kind, body) values ($1,$2,$3,$4,$5)`,
    [newId("th"), userId, threadId, kind, body],
  );
}

async function chooseAgentName(sql: Sql, userId: string, threadId: string): Promise<string> {
  const roster = await sql.query<{ name: string }>(
    `select name from agent_roster where user_id = $1 order by created_at asc`,
    [userId],
  );
  if (roster.length > 0) return pickFromRoster(threadId, roster.map((r) => r.name));
  return pickAgentName(threadId);
}

async function ensureAgentName(
  sql: Sql,
  userId: string,
  threadId: string,
  existing: string | null | undefined,
): Promise<string> {
  if (existing) return existing;
  const name = await chooseAgentName(sql, userId, threadId);
  await sql.query(
    `update agent_threads set agent_name = $1 where id = $2 and user_id = $3 and agent_name is null`,
    [name, threadId, userId],
  );
  return name;
}

async function commitBubbles(
  sql: Sql,
  opts: {
    userId: string;
    personaId: string;
    threadId: string;
    peerId: string | null;
    agentName: string;
    workflow: WorkflowId;
    bubbles: string[];
    offerId: string | null;
    wantAuto: boolean;
    takeover?: boolean;
    optOut?: boolean;
    emergencyStop?: boolean;
    origin: GenerationOrigin;
  },
): Promise<{ auto: boolean; partial: boolean }> {
  const ids: string[] = [];
  const replyId = newId("rep");
  for (let i = 0; i < opts.bubbles.length; i++) {
    const bubble = opts.bubbles[i]!;
    const id = newId("msg");
    ids.push(id);
    await sql.query(
      `insert into agent_messages
        (id, user_id, thread_id, role, body, workflow, offer_id, auto, status, agent_name, origin, reply_id, bubble_index)
       values ($1,$2,$3,'draft',$4,$5,$6,false,'held',$7,$8,$9,$10)`,
      [id, opts.userId, opts.threadId, bubble, opts.workflow, opts.offerId, opts.agentName, opts.origin, replyId, i],
    ).catch(async () => {
      await sql.query(
        `insert into agent_messages
          (id, user_id, thread_id, role, body, workflow, offer_id, auto, status, agent_name)
         values ($1,$2,$3,'draft',$4,$5,$6,false,'held',$7)`,
        [id, opts.userId, opts.threadId, bubble, opts.workflow, opts.offerId, opts.agentName],
      );
    });
  }
  await recordActivity(sql, {
    userId: opts.userId,
    personaId: opts.personaId,
    threadId: opts.threadId,
    agentName: opts.agentName,
    kind: "typing",
    body: opts.workflow,
  });
  if (!opts.wantAuto) {
    await recordActivity(sql, {
      userId: opts.userId,
      personaId: opts.personaId,
      threadId: opts.threadId,
      agentName: opts.agentName,
      kind: "held",
    });
    return { auto: false, partial: false };
  }

  if (!opts.peerId) {
    await recordActivity(sql, {
      userId: opts.userId,
      personaId: opts.personaId,
      threadId: opts.threadId,
      agentName: opts.agentName,
      kind: "held",
      body: "no peer",
    });
    return { auto: false, partial: false };
  }

  let sent = 0;
  let fail: string | null = null;
  for (let i = 0; i < opts.bubbles.length; i++) {
    const bubble = opts.bubbles[i]!;
    const id = ids[i]!;
    const result = await tryDispatchAutoSend({
      userId: opts.userId,
      peer: opts.peerId,
      chat: opts.peerId,
      body: bubble,
      agentName: opts.agentName,
      threadId: opts.threadId,
      takeover: opts.takeover,
      optOut: opts.optOut,
      emergencyStop: opts.emergencyStop,
    });
    if (result.status === "ok") {
      await sql.query(
        `update agent_messages
            set role = 'persona', status = 'sent', auto = true, origin = 'confirmed_ai_outbox',
                transport_message_id = $3
          where id = $1 and user_id = $2`,
        [id, opts.userId, result.telegramMessageId ?? null],
      ).catch(async () => {
        await sql.query(
          `update agent_messages
              set role = 'persona', status = 'sent', auto = true
            where id = $1 and user_id = $2`,
          [id, opts.userId],
        );
      });
      sent += 1;
      continue;
    }
    const reason = result.status === "fail" || result.status === "uncertain" ? result.error : result.status;
    fail = reason ?? result.status;
    const status = result.status === "not_live" ? "local" : result.status === "uncertain" ? "uncertain" : "held";
    await sql.query(
      `update agent_messages set status = $3 where id = $1 and user_id = $2`,
      [id, opts.userId, status],
    );
    break;
  }

  if (fail) {
    await sql.query(
      `insert into agent_tickets (id, user_id, thread_id, kind, body)
       values ($1,$2,$3,'dispatch',$4)`,
      [newId("tix"), opts.userId, opts.threadId, `Auto-send ${fail}`.slice(0, 500)],
    );
    await recordActivity(sql, {
      userId: opts.userId,
      personaId: opts.personaId,
      threadId: opts.threadId,
      agentName: opts.agentName,
      kind: sent > 0 ? "held" : "failed",
      body: fail.slice(0, 280),
    });
    return { auto: sent > 0, partial: sent > 0 && sent < opts.bubbles.length };
  }

  await recordActivity(sql, {
    userId: opts.userId,
    personaId: opts.personaId,
    threadId: opts.threadId,
    agentName: opts.agentName,
    kind: "sent",
  });
  return { auto: true, partial: false };
}

async function completeIdempotency(
  sql: Sql,
  userId: string,
  key: string | undefined,
  result: { threadId: string; workflow: WorkflowId; held: boolean; killed: boolean; auto: boolean },
) {
  if (!key) return;
  await sql.query(
    `update agent_idempotency
        set status = 'completed', thread_id = $3, result_json = $4, lease_until = null
      where user_id = $1 and key = $2`,
    [userId, key, result.threadId, JSON.stringify(result)],
  ).catch(() => undefined);
}

type InboundResult = { threadId: string; workflow: WorkflowId; held: boolean; killed: boolean; auto: boolean };

function heldIngest(threadId: string): InboundResult {
  return { threadId, workflow: "W1_INGEST", held: true, killed: false, auto: false };
}

async function claimOrReplayIdempotency(
  sql: Sql,
  userId: string,
  key: string,
  threadId: string | undefined,
): Promise<"proceed" | InboundResult> {
  try {
    await sql.query(
      `insert into agent_idempotency (id, user_id, key, status, thread_id, attempt_count, lease_until)
       values ($1,$2,$3,'claimed',$4,1, now() + interval '2 minutes')`,
      [newId("idm"), userId, key, threadId ?? null],
    );
    return "proceed";
  } catch (err) {
    const existing = (
      await sql.query<{
        status: string | null;
        thread_id: string | null;
        result_json: string | null;
        lease_until: string | Date | null;
      }>(
        `select status, thread_id, result_json, lease_until from agent_idempotency
          where user_id = $1 and key = $2 limit 1`,
        [userId, key],
      ).catch(async () =>
        sql.query<{
          status: string | null;
          thread_id: string | null;
          result_json: string | null;
          lease_until: string | Date | null;
        }>(
          `select null as status, thread_id, null as result_json, null as lease_until from agent_idempotency
            where user_id = $1 and key = $2 limit 1`,
          [userId, key],
        ),
      )
    )[0];

    if (!existing) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code && code !== "23505") throw err;
      return heldIngest(threadId ?? "");
    }

    const hit = resolveIdempotencyHit(existing);
    if (hit.action === "replay") {
      const parsed = hit.result as InboundResult;
      if (parsed.threadId) return parsed;
    }
    if (hit.action === "in_flight") return heldIngest(threadId ?? existing.thread_id ?? "");
    if (hit.action === "reclaim") {
      const reclaimed = await sql.query<{ id: string }>(
        `update agent_idempotency
            set attempt_count = coalesce(attempt_count, 0) + 1,
                status = 'claimed',
                lease_until = now() + interval '2 minutes'
          where user_id = $1 and key = $2
            and (status is distinct from 'completed')
            and (lease_until is null or lease_until < now())
          returning id`,
        [userId, key],
      ).catch(async () => {
        await sql.query(
          `update agent_idempotency set key = key where user_id = $1 and key = $2`,
          [userId, key],
        );
        return [{ id: "reclaimed" }];
      });
      if (reclaimed[0]) return "proceed";
      return heldIngest(threadId ?? existing.thread_id ?? "");
    }
    return heldIngest(threadId ?? existing.thread_id ?? "");
  }
}

export async function processInbound(opts: {
  userId: string;
  threadId?: string;
  fanId?: string;
  text: string;
  idempotencyKey?: string;
  source?: Source;
  forceHold?: boolean;
}): Promise<{ threadId: string; workflow: WorkflowId; held: boolean; killed: boolean; auto: boolean }> {
  const sql = await getSql();

  let threadId = opts.threadId;
  let fanId = opts.fanId;
  let personaId: string | null = null;
  if (threadId) {
    const row = (
      await sql.query<{ fan_id: string; user_id: string; persona_id: string }>(
        `select fan_id, user_id, persona_id from agent_threads where id = $1 and user_id = $2`,
        [threadId, opts.userId],
      )
    )[0];
    if (!row) throw new Error("thread not found");
    fanId = row.fan_id;
    personaId = row.persona_id;
  } else {
    personaId = await ensureSeed(opts.userId);
  }
  if (!personaId) personaId = await ensureSeed(opts.userId);

  if (opts.idempotencyKey) {
    const claimed = await claimOrReplayIdempotency(sql, opts.userId, opts.idempotencyKey, threadId);
    if (claimed !== "proceed") return claimed;
  }

  const persona = (
    await sql.query<{
      id: string;
      display_name: string;
      bible: string;
      timezone: string;
      auto_send: boolean;
      quiet_start: number;
      quiet_end: number;
      emergency_stop?: boolean;
      automation_mode?: string;
    }>(
      `select id, display_name, bible, timezone, auto_send, quiet_start, quiet_end,
              coalesce(emergency_stop, false) as emergency_stop,
              coalesce(automation_mode, 'draft') as automation_mode
         from agent_personas where id = $1`,
      [personaId],
    ).catch(() =>
      sql.query<{
        id: string;
        display_name: string;
        bible: string;
        timezone: string;
        auto_send: boolean;
        quiet_start: number;
        quiet_end: number;
      }>(
        `select id, display_name, bible, timezone, auto_send, quiet_start, quiet_end
           from agent_personas where id = $1`,
        [personaId],
      ),
    )
  )[0];
  if (!persona) throw new Error("persona missing");

  if (!threadId) {
    fanId = newId("fan");
    threadId = newId("thr");
    await sql.query(
      `insert into agent_fans (id, user_id, persona_id, display_name, handle, source, archetype)
       values ($1,$2,$3,'Unknown',null,$4,'new')`,
      [fanId, opts.userId, personaId, opts.source ?? "telegram"],
    );
    await sql.query(
      `insert into agent_threads (id, user_id, persona_id, fan_id, workflow, state)
       values ($1,$2,$3,$4,'W1_INGEST','open')`,
      [threadId, opts.userId, personaId, fanId],
    );
  }

  const fan = (
    await sql.query<{
      display_name: string;
      source: string;
      archetype: string;
      lifetime_cents: number;
      trust: number;
      tg_peer_id: string | null;
    }>(
      `select display_name, source, archetype, lifetime_cents, trust, tg_peer_id from agent_fans
        where id = $1 and user_id = $2`,
      [fanId, opts.userId],
    )
  )[0];
  const thread = (
    await sql.query<{
      takeover: boolean;
      workflow: string;
      last_inbound_at: string | Date | null;
      last_outbound_at: string | Date | null;
      agent_name: string | null;
      state?: string;
      opt_out?: boolean;
      adult_eligibility?: string;
    }>(
      `select takeover, workflow, last_inbound_at, last_outbound_at, agent_name, state,
              coalesce(opt_out, false) as opt_out,
              coalesce(adult_eligibility, 'unknown') as adult_eligibility
         from agent_threads
        where id = $1`,
      [threadId],
    ).catch(() =>
      sql.query<{
        takeover: boolean;
        workflow: string;
        last_inbound_at: string | Date | null;
        last_outbound_at: string | Date | null;
        agent_name: string | null;
        state?: string;
      }>(
        `select takeover, workflow, last_inbound_at, last_outbound_at, agent_name, state from agent_threads
          where id = $1`,
        [threadId],
      ),
    )
  )[0];

  const now = new Date();
  const hour = hourInZone(now, persona.timezone);
  const quiet = inWindow(hour, persona.quiet_start, persona.quiet_end);
  const agentName = await ensureAgentName(sql, opts.userId, threadId, thread.agent_name);

  await sql.query(
    `insert into agent_messages (id, user_id, thread_id, role, body, status, origin)
     values ($1,$2,$3,'fan',$4,'sent','observed_partner')`,
    [newId("msg"), opts.userId, threadId, opts.text],
  ).catch(async () => {
    await sql.query(
      `insert into agent_messages (id, user_id, thread_id, role, body, status)
       values ($1,$2,$3,'fan',$4,'sent')`,
      [newId("msg"), opts.userId, threadId, opts.text],
    );
  });
  await sql.query(
    `update agent_threads set last_inbound_at = $1, unread = unread + 1 where id = $2`,
    [now.toISOString(), threadId],
  );
  await thought(sql, opts.userId, threadId, "ingest", `W1 INGEST. Normalized. Idempotent key attached.`);
  await recordActivity(sql, {
    userId: opts.userId,
    personaId,
    threadId,
    agentName,
    kind: "inbound",
    body: opts.text.slice(0, 280),
  });

  const safety = runSafety(opts.text);
  await thought(sql, opts.userId, threadId, "safety", `W2 SAFETY ${safety.verdict}. ${safety.note}`);

  if (safety.codes.includes("opt_out") || colBool(thread, "opt_out")) {
    await sql.query(
      `update agent_threads set opt_out = true, opt_out_at = now(), takeover = true, state = 'killed', workflow = 'W15_HANDOFF' where id = $1`,
      [threadId],
    ).catch(async () => {
      await sql.query(
        `update agent_threads set takeover = true, state = 'killed', workflow = 'W15_HANDOFF' where id = $1`,
        [threadId],
      );
    });
    await thought(sql, opts.userId, threadId, "handoff", "Partner opt-out. No reply.");
    const result = { threadId, workflow: "W15_HANDOFF" as const, held: true, killed: true, auto: false };
    await completeIdempotency(sql, opts.userId, opts.idempotencyKey, result);
    return result;
  }

  if (safetyBlocksGenerate(safety.verdict)) {
    const refuse = SAFETY_REFUSALS[safety.codes[0] ?? "minor"] ?? SAFETY_REFUSALS.minor;
    const killed = safety.verdict === "kill";
    await sql.query(
      `insert into agent_messages (id, user_id, thread_id, role, body, workflow, status)
       values ($1,$2,$3,'system',$4,'W2_SAFETY','held')`,
      [newId("msg"), opts.userId, threadId, refuse],
    );
    await sql.query(
      `update agent_threads set workflow = 'W15_HANDOFF', state = $1, takeover = true where id = $2`,
      [killed ? "killed" : "handoff", threadId],
    );
    await thought(
      sql,
      opts.userId,
      threadId,
      "handoff",
      killed ? "Thread killed. Writer never ran." : "Handoff. Writer never ran.",
    );
    await recordActivity(sql, {
      userId: opts.userId,
      personaId,
      threadId,
      agentName,
      kind: killed ? "killed" : "handoff",
    });
    const result = { threadId, workflow: "W15_HANDOFF" as const, held: true, killed, auto: false };
    await completeIdempotency(sql, opts.userId, opts.idempotencyKey, result);
    return result;
  }

  const countRows = await sql.query<{ n: number }>(
    `select count(*)::int as n from agent_messages
      where thread_id = $1 and (
        role = 'fan'
        or (role = 'persona' and status in ('sent', 'sent_confirmed'))
      )`,
    [threadId],
  );
  const turns = Number(countRows[0]?.n ?? 1);
  const u = understandLocal(opts.text, {
    lifetimeCents: fan.lifetime_cents,
    source: (opts.source ?? fan.source) as Source,
    archetype: fan.archetype as Archetype,
    turns,
  });
  await thought(
    sql,
    opts.userId,
    threadId,
    "triage",
    `W3 TRIAGE intent=${u.intent} objection=${u.objection} archetype=${u.archetype} source=${u.source}`,
  );

  const lastOut = thread.last_outbound_at ? new Date(iso(thread.last_outbound_at) ?? now).getTime() : 0;
  const silentDays = lastOut ? (now.getTime() - lastOut) / 86400000 : 0;
  const justDelivered = (
    await sql.query<{ n: number }>(
      `select count(*)::int as n from agent_offers
        where thread_id = $1 and status = 'delivered'
          and delivered_at > now() - interval '2 hours'`,
      [threadId],
    )
  )[0];
  const gfeHeld = (
    await sql.query<{ n: number }>(
      `select count(*)::int as n from conversation_reservations
        where persona_id = $1 and partner_id = $2 and kind = 'gfe' and status in ('held','confirmed')`,
      [personaId, fanId],
    ).catch(async () => {
      const seats = await sql.query<{ held: number }>(
        `select held from agent_seats where persona_id = $1 and kind = 'gfe'`,
        [personaId],
      );
      return [{ n: Number(seats[0]?.held ?? 0) > 0 ? 1 : 0 }];
    })
  )[0];
  const openCount = (
    await sql.query<{ n: number }>(
      `select count(*)::int as n from agent_threads where user_id = $1 and state = 'open'`,
      [opts.userId],
    )
  )[0];

  const firstOffer = (
    await sql.query<{ n: number }>(
      `select count(*)::int as n from agent_offers where thread_id = $1`,
      [threadId],
    )
  )[0];
  const gold = goldSummary();
  const autoEnabled =
    Boolean(persona.auto_send) && parseAutomationMode(colText(persona, "automation_mode", "draft")) === "approved_auto";
  const fulfilling = thread.state === "fulfilling" || thread.workflow === "W9_FULFILL";

  const workflow = routeWorkflow(safety, u, {
    lifetimeCents: fan.lifetime_cents,
    turns,
    takeover: Boolean(thread.takeover),
    justDelivered: Number(justDelivered?.n ?? 0) > 0,
    silentDays,
    gfeHeld: Number(gfeHeld?.n ?? 0) > 0,
    overflow: Number(openCount?.n ?? 0) > 20,
    whale: fan.lifetime_cents >= 20000 || u.archetype === "whale",
    firstOfferSent: Number(firstOffer?.n ?? 0) > 0,
    activeFulfillment: fulfilling,
    optOut: colBool(thread, "opt_out"),
  });
  const plan = buildPlan(workflow, u, {
    lifetimeCents: fan.lifetime_cents,
    turns,
    takeover: Boolean(thread.takeover),
    justDelivered: Number(justDelivered?.n ?? 0) > 0,
    silentDays,
    gfeHeld: Number(gfeHeld?.n ?? 0) > 0,
    overflow: Number(openCount?.n ?? 0) > 20,
    whale: fan.lifetime_cents >= 20000,
    firstOfferSent: Number(firstOffer?.n ?? 0) > 0,
  }, autoEnabled);

  await thought(sql, opts.userId, threadId, "route", `Routed ${workflow}. ${plan.reason}`);
  await sql.query(
    `insert into agent_plans
      (id, user_id, thread_id, workflow, strategy, tactic, offer_id, hold, reason, doors_json, check_in_h)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      newId("pln"),
      opts.userId,
      threadId,
      plan.workflow,
      plan.strategy,
      plan.tactic,
      null,
      plan.hold,
      plan.reason,
      JSON.stringify(plan.doors),
      plan.checkInHours,
    ],
  );

  const claims = await sql.query<{
    kind: string;
    claim: string;
    start_hour: number | null;
    end_hour: number | null;
  }>(
    `select kind, claim, start_hour, end_hour from agent_persona_claims where persona_id = $1`,
    [personaId],
  );
  const clock: ClockSlot[] = claims.map((c) => ({
    kind: c.kind,
    claim: c.claim,
    startHour: c.start_hour,
    endHour: c.end_hour,
  }));
  await thought(sql, opts.userId, threadId, "clock", `W18 LIFE-CLOCK ${clockLabel(hour, clock)}`);

  if (safety.verdict === "refuse") {
    const code = safety.codes[0] ?? "irl";
    const line = SAFETY_REFUSALS[code] ?? SAFETY_REFUSALS.irl;
    await sql.query(
      `insert into agent_messages (id, user_id, thread_id, role, body, workflow, status, agent_name)
       values ($1,$2,$3,'draft',$4,$5,'held',$6)`,
      [newId("msg"), opts.userId, threadId, line, workflow, agentName],
    );
    await sql.query(
      `update agent_threads set workflow = $1, state = 'held' where id = $2`,
      [workflow, threadId],
    );
    await thought(sql, opts.userId, threadId, "write", "Refuse draft. Writer skipped on safety.");
    await recordActivity(sql, {
      userId: opts.userId,
      personaId,
      threadId,
      agentName,
      kind: "held",
    });
    const result = { threadId, workflow, held: true, killed: false, auto: false };
    await completeIdempotency(sql, opts.userId, opts.idempotencyKey, result);
    return result;
  }

  if (thread.takeover) {
    await sql.query(
      `update agent_threads set workflow = 'W15_HANDOFF', state = 'handoff' where id = $1`,
      [threadId],
    );
    await thought(sql, opts.userId, threadId, "handoff", "Takeover on. AI paused.");
    await recordActivity(sql, {
      userId: opts.userId,
      personaId,
      threadId,
      agentName,
      kind: "handoff",
    });
    const result = { threadId, workflow: "W15_HANDOFF" as const, held: true, killed: false, auto: false };
    await completeIdempotency(sql, opts.userId, opts.idempotencyKey, result);
    return result;
  }

  if (workflow === "W15_HANDOFF") {
    await sql.query(
      `update agent_threads set workflow = 'W15_HANDOFF', state = 'handoff', takeover = true where id = $1`,
      [threadId],
    );
    await thought(sql, opts.userId, threadId, "handoff", "Handoff workflow. Writer skipped.");
    await recordActivity(sql, {
      userId: opts.userId,
      personaId,
      threadId,
      agentName,
      kind: "handoff",
    });
    const result = { threadId, workflow: "W15_HANDOFF" as const, held: true, killed: false, auto: false };
    await completeIdempotency(sql, opts.userId, opts.idempotencyKey, result);
    return result;
  }

  const catalog = await sql.query<{
    id: string;
    sku: string;
    title: string;
    price_cents: number;
    rail: string;
    eligibility: string;
  }>(
    `select id, sku, title, price_cents, rail, eligibility from agent_catalog
      where persona_id = $1 and active = true`,
    [personaId],
  );
  const catalogRows: CatalogRow[] = catalog.map((r) => ({
    id: r.id,
    sku: r.sku,
    title: r.title,
    priceCents: r.price_cents,
    rail: r.rail,
    eligibility: r.eligibility,
  }));
  const diary = await sql.query<{ voice: DiaryVoice; body: string }>(
    `select voice, body from agent_diary where fan_id = $1 order by created_at desc limit 12`,
    [fanId],
  );
  const last = await sql.query<{ role: string; body: string; status: string; origin?: string | null }>(
    `select role, body, status, origin from agent_messages
      where thread_id = $1
      order by created_at desc limit 40`,
    [threadId],
  ).catch(() =>
    sql.query<{ role: string; body: string; status: string }>(
      `select role, body, status from agent_messages
        where thread_id = $1
        order by created_at desc limit 40`,
      [threadId],
    ),
  );
  const confirmed = confirmedTranscript(last).reverse();

  try {
    const { rememberFan } = await import("./memory.server.ts");
    await rememberFan({
      fanId: fanId!,
      inbound: opts.text,
      diary,
      last: confirmed,
      lifetimeCents: fan.lifetime_cents,
    });
  } catch {
    /* memory must never block inbound */
  }

  if (workflow === "W7_GFE") {
    const reserved = await sql.query<{ id: string }>(
      `insert into conversation_reservations
        (id, user_id, persona_id, partner_id, kind, status, expires_at)
       values ($1,$2,$3,$4,'gfe','held', now() + interval '2 hours')
       on conflict do nothing
       returning id`,
      [newId("rsv"), opts.userId, personaId, fanId],
    ).catch(async () => {
      try {
        return await sql.query<{ id: string }>(
          `insert into conversation_reservations
            (id, user_id, persona_id, partner_id, kind, status, expires_at)
           values ($1,$2,$3,$4,'gfe','held', now() + interval '2 hours')
           returning id`,
          [newId("rsv"), opts.userId, personaId, fanId],
        );
      } catch {
        return [] as { id: string }[];
      }
    });
    if (reserved[0]) {
      await sql.query(
        `update agent_seats set held = least(capacity, held + 1), updated_at = now()
          where persona_id = $1 and kind = 'gfe' and held < capacity`,
        [personaId],
      );
      await thought(sql, opts.userId, threadId, "plan", "GFE seat reserved for this partner. First contract stays human.");
    } else {
      await thought(sql, opts.userId, threadId, "plan", "GFE already reserved or unavailable for this partner.");
    }
  }

  let proofReady = false;
  if (workflow === "W13_PROOF") {
    const claimed = await sql.query<{ id: string; label: string }>(
      `update agent_proof_assets
          set used_fan_id = $1
        where id = (
          select id from agent_proof_assets
           where persona_id = $2 and used_fan_id is null and live = false
           order by created_at
           for update skip locked
           limit 1
        )
        returning id, label`,
      [fanId, personaId],
    ).catch(async () =>
      sql.query<{ id: string; label: string }>(
        `update agent_proof_assets
            set used_fan_id = $1
          where id = (
            select id from agent_proof_assets
             where persona_id = $2 and used_fan_id is null and live = false
             limit 1
          )
            and used_fan_id is null
          returning id, label`,
        [fanId, personaId],
      ),
    );
    if (claimed[0]) {
      await thought(sql, opts.userId, threadId, "plan", `Proof reserved: ${claimed[0].label}. 1 asset / partner.`);
    }
    proofReady = Boolean(claimed[0]);
  }

  const written = await writeWithGateway(opts.userId, threadId, {
    plan,
    personaName: persona.display_name,
    bible: persona.bible,
    clock,
    hour,
    diary,
    last: confirmed,
    catalog: catalogRows,
    fanName: fan.display_name,
    inbound: opts.text,
    proofAvailable: proofReady,
    deliveryConfirmed: Number(justDelivered?.n ?? 0) > 0,
  });
  await thought(
    sql,
    opts.userId,
    threadId,
    "write",
    written.dropped
      ? `Draft dropped (${written.dropReason}). Hold.`
      : `Writer ${written.model}. ${written.bubbles.length} bubble(s).`,
  );

  const wantAuto =
    !opts.forceHold &&
    decideAutoSend({
      personaAutoSend: Boolean(persona.auto_send),
      goldAllowed: gold.autoSendAllowed,
      quiet,
      takeover: Boolean(thread.takeover),
      workflow: plan.workflow,
      dropped: written.dropped,
      killed: false,
      bubbleCount: written.bubbles.length,
      safetyVerdict: safety.verdict,
      emergencyStop: colBool(persona, "emergency_stop"),
      partnerOptOut: colBool(thread, "opt_out"),
      automationMode: parseAutomationMode(colText(persona, "automation_mode", "draft")),
      generationOrigin: generationOriginForWrite(written),
      adultEligibility: (colText(thread, "adult_eligibility", "unknown") as "allowed" | "unknown" | "disallowed") ?? "unknown",
      accountLive: Boolean(fan.tg_peer_id),
      conversationPermitted: true,
    });

  if (written.bubbles.length === 0) {
    await sql.query(
      `update agent_threads set workflow = $1, state = 'held' where id = $2`,
      [workflow, threadId],
    );
    await recordActivity(sql, {
      userId: opts.userId,
      personaId,
      threadId,
      agentName,
      kind: "held",
      body: written.dropReason,
    });
    const result = { threadId, workflow, held: true, killed: false, auto: false };
    await completeIdempotency(sql, opts.userId, opts.idempotencyKey, result);
    return result;
  }

  const sku = findSku(catalogRows, plan.sku);
  let offerId: string | null = null;
  if (sku && (workflow === "W6_CLOSE_NOW" || workflow === "W8_OFFER")) {
    offerId = newId("off");
    await sql.query(
      `insert into agent_offers (id, user_id, persona_id, fan_id, thread_id, sku, price_cents, status)
       values ($1,$2,$3,$4,$5,$6,$7,'draft')`,
      [offerId, opts.userId, personaId, fanId, threadId, sku.sku, sku.priceCents],
    );
  }

  const committed = await commitBubbles(sql, {
    userId: opts.userId,
    personaId,
    threadId,
    peerId: fan.tg_peer_id,
    agentName,
    workflow,
    bubbles: written.bubbles,
    offerId,
    wantAuto,
    takeover: Boolean(thread.takeover),
    optOut: colBool(thread, "opt_out"),
    emergencyStop: colBool(persona, "emergency_stop"),
    origin: generationOriginForWrite(written),
  });
  const auto = committed.auto;
  const state: ThreadState = fulfilling ? "fulfilling" : auto ? "open" : "held";

  if (plan.checkInHours) {
    const runAt = new Date(now.getTime() + plan.checkInHours * 3600_000).toISOString();
    await sql.query(
      `insert into agent_jobs (id, user_id, thread_id, kind, run_at, payload)
       values ($1,$2,$3,'check_in',$4,$5)`,
      [newId("job"), opts.userId, threadId, runAt, JSON.stringify({ workflow: "W11_REACTIVATE" })],
    );
  }

  await sql.query(
    `update agent_threads set workflow = $1, state = $2, last_outbound_at = case when $3 then $4 else last_outbound_at end
      where id = $5`,
    [workflow, state, auto, now.toISOString(), threadId],
  );
  await sql.query(`update agent_fans set archetype = $1 where id = $2`, [u.archetype, fanId]);

  const diaryLine = diaryPatch(u.intent, opts.text);
  if (diaryLine) {
    await sql.query(
      `insert into agent_diary (id, user_id, persona_id, fan_id, voice, body)
       values ($1,$2,$3,$4,'HIM',$5)`,
      [newId("dia"), opts.userId, personaId, fanId, diaryLine],
    );
    await thought(sql, opts.userId, threadId, "diary", `HIM patched. ${diaryLine}`);
  }

  await thought(
    sql,
    opts.userId,
    threadId,
    "desk",
    auto ? "W19 DESK. Auto-sent." : "W19 DESK. Thought + diary only. Never to buyer.",
  );

  const result = { threadId, workflow, held: !auto, killed: false, auto };
  await completeIdempotency(sql, opts.userId, opts.idempotencyKey, result);
  return result;
}

function diaryPatch(intent: string, text: string): string | null {
  if (intent === "greeting") return null;
  const clipped = text.trim().slice(0, 140);
  if (clipped.length < 8) return null;
  return clipped;
}

export async function tickAgentJobs(userId?: string): Promise<number> {
  const token = newId("claim");
  const due = await withTransaction((tx) =>
    claimDueJobs(tx, token, userId ? { userId, limit: 20 } : { limit: 20 }),
  );
  const sql = await getSql();
  let n = 0;
  for (const job of due) {
    try {
      if (job.kind === "fulfillment" && job.thread_id) {
        const pending = (
          await sql.query<{ id: string }>(
            `select id from agent_offers
              where thread_id = $1 and status = 'paid' and delivered_at is null
              limit 1`,
            [job.thread_id],
          )
        )[0];
        if (pending) {
          const ticket = await ensureSlaTicket(sql, {
            userId: job.user_id,
            threadId: job.thread_id,
            offerId: pending.id,
          });
          if (ticket.inserted) {
            await thought(
              sql,
              job.user_id,
              job.thread_id,
              "handoff",
              "W9 FULFILL watchdog. PAID still sitting. Ticket for operator.",
            );
          }
        }
      } else if (job.kind === "check_in" && job.thread_id) {
        await runCheckIn(sql, job.user_id, job.thread_id);
      }
    } catch (err) {
      console.info("[agent]", { event: "job_fail", id: job.id, err: String(err).slice(0, 120) });
      await finalizeJob(sql, job.id, token, { ok: false, error: String(err) });
      continue;
    }
    const done = await finalizeJob(sql, job.id, token, { ok: true });
    if (done) n += 1;
  }
  return n;
}

async function runCheckIn(sql: Sql, userId: string, threadId: string) {
  const thread = (
    await sql.query<{
      takeover: boolean;
      last_outbound_at: string | Date | null;
      last_inbound_at: string | Date | null;
      fan_id: string;
      persona_id: string;
      agent_name: string | null;
      opt_out?: boolean;
    }>(
      `select takeover, last_outbound_at, last_inbound_at, fan_id, persona_id, agent_name,
              coalesce(opt_out, false) as opt_out
         from agent_threads
        where id = $1 and user_id = $2`,
      [threadId, userId],
    ).catch(() =>
      sql.query<{
        takeover: boolean;
        last_outbound_at: string | Date | null;
        last_inbound_at: string | Date | null;
        fan_id: string;
        persona_id: string;
        agent_name: string | null;
      }>(
        `select takeover, last_outbound_at, last_inbound_at, fan_id, persona_id, agent_name from agent_threads
          where id = $1 and user_id = $2`,
        [threadId, userId],
      ),
    )
  )[0];
  if (!thread || thread.takeover || colBool(thread, "opt_out")) return;
  if (thread.last_outbound_at) {
    const age = Date.now() - new Date(iso(thread.last_outbound_at) ?? 0).getTime();
    if (age < 3 * 3600_000) return;
  }
  if (thread.last_inbound_at && thread.last_outbound_at) {
    const inbound = new Date(iso(thread.last_inbound_at) ?? 0).getTime();
    const outbound = new Date(iso(thread.last_outbound_at) ?? 0).getTime();
    if (inbound > outbound) return;
  }
  const held = (
    await sql.query<{ id: string }>(
      `select id from agent_messages
        where thread_id = $1 and role = 'draft' and status = 'held' limit 1`,
      [threadId],
    )
  )[0];
  if (held) return;

  const persona = (
    await sql.query<{
      display_name: string;
      bible: string;
      timezone: string;
      auto_send: boolean;
      quiet_start: number;
      quiet_end: number;
      emergency_stop?: boolean;
      automation_mode?: string;
    }>(
      `select display_name, bible, timezone, auto_send, quiet_start, quiet_end,
              coalesce(emergency_stop, false) as emergency_stop,
              coalesce(automation_mode, 'draft') as automation_mode
         from agent_personas where id = $1`,
      [thread.persona_id],
    ).catch(() =>
      sql.query<{
        display_name: string;
        bible: string;
        timezone: string;
        auto_send: boolean;
        quiet_start: number;
        quiet_end: number;
      }>(
        `select display_name, bible, timezone, auto_send, quiet_start, quiet_end from agent_personas where id = $1`,
        [thread.persona_id],
      ),
    )
  )[0];
  const fan = (
    await sql.query<{
      display_name: string;
      lifetime_cents: number;
      archetype: string;
      source: string;
      tg_peer_id: string | null;
    }>(
      `select display_name, lifetime_cents, archetype, source, tg_peer_id from agent_fans where id = $1`,
      [thread.fan_id],
    )
  )[0];
  if (!persona || !fan) return;
  if (colBool(persona, "emergency_stop")) return;

  const catalog = await sql.query<{
    id: string;
    sku: string;
    title: string;
    price_cents: number;
    rail: string;
    eligibility: string;
  }>(
    `select id, sku, title, price_cents, rail, eligibility from agent_catalog
      where persona_id = $1 and active = true`,
    [thread.persona_id],
  );
  const catalogRows: CatalogRow[] = catalog.map((r) => ({
    id: r.id,
    sku: r.sku,
    title: r.title,
    priceCents: r.price_cents,
    rail: r.rail,
    eligibility: r.eligibility,
  }));
  const diary = await sql.query<{ voice: DiaryVoice; body: string }>(
    `select voice, body from agent_diary where fan_id = $1 order by created_at desc limit 12`,
    [thread.fan_id],
  );
  const last = await sql.query<{ role: string; body: string; status?: string }>(
    `select role, body, status from agent_messages
      where thread_id = $1
      order by created_at desc limit 20`,
    [threadId],
  );
  const confirmed = confirmedTranscript(last).reverse();
  try {
    const { rememberFan } = await import("./memory.server.ts");
    await rememberFan({
      fanId: thread.fan_id,
      inbound: confirmed.filter((m) => m.role === "fan").at(-1)?.body ?? "",
      diary,
      last: confirmed,
      lifetimeCents: fan.lifetime_cents,
    });
  } catch {
    /* memory must never block jobs */
  }
  const claims = await sql.query<{
    kind: string;
    claim: string;
    start_hour: number | null;
    end_hour: number | null;
  }>(`select kind, claim, start_hour, end_hour from agent_persona_claims where persona_id = $1`, [
    thread.persona_id,
  ]);
  const clock: ClockSlot[] = claims.map((c) => ({
    kind: c.kind,
    claim: c.claim,
    startHour: c.start_hour,
    endHour: c.end_hour,
  }));
  const u: UnderstandResult = {
    intent: "silent_return",
    objection: "none",
    archetype: fan.archetype as Archetype,
    source: fan.source as Source,
    wantsSku: null,
    gfeNamed: false,
    mediaKind: "none",
  };
  const ctx = {
    lifetimeCents: fan.lifetime_cents,
    turns: confirmed.length,
    takeover: false,
    justDelivered: false,
    silentDays: 6,
    gfeHeld: false,
    overflow: false,
    whale: fan.lifetime_cents >= 20000,
    firstOfferSent: true,
  };
  const gold = goldSummary();
  const autoEnabled =
    Boolean(persona.auto_send) && parseAutomationMode(colText(persona, "automation_mode", "draft")) === "approved_auto";
  const now = new Date();
  const hour = hourInZone(now, persona.timezone);
  const quiet = inWindow(hour, persona.quiet_start, persona.quiet_end);
  const plan = buildPlan("W11_REACTIVATE", u, ctx, autoEnabled);
  const written = await writeWithGateway(userId, threadId, {
    plan,
    personaName: persona.display_name,
    bible: persona.bible,
    clock,
    hour,
    diary,
    last: confirmed,
    catalog: catalogRows,
    fanName: fan.display_name,
    inbound: "",
  });
  if (written.bubbles.length === 0) return;
  const agentName = await ensureAgentName(sql, userId, threadId, thread.agent_name);
  const wantAuto = decideAutoSend({
    personaAutoSend: Boolean(persona.auto_send),
    goldAllowed: gold.autoSendAllowed,
    quiet,
    takeover: false,
    workflow: plan.workflow,
    dropped: written.dropped,
    killed: false,
    bubbleCount: written.bubbles.length,
    safetyVerdict: "allow",
    emergencyStop: colBool(persona, "emergency_stop"),
    partnerOptOut: colBool(thread, "opt_out"),
    automationMode: parseAutomationMode(colText(persona, "automation_mode", "draft")),
    generationOrigin: generationOriginForWrite(written),
    accountLive: Boolean(fan.tg_peer_id),
    conversationPermitted: true,
  });
  const committed = await commitBubbles(sql, {
    userId,
    personaId: thread.persona_id,
    threadId,
    peerId: fan.tg_peer_id,
    agentName,
    workflow: "W11_REACTIVATE",
    bubbles: written.bubbles,
    offerId: null,
    wantAuto,
    takeover: Boolean(thread.takeover),
    optOut: colBool(thread, "opt_out"),
    emergencyStop: colBool(persona, "emergency_stop"),
    origin: generationOriginForWrite(written),
  });
  if (committed.auto) {
    await sql.query(
      `update agent_threads set workflow = 'W11_REACTIVATE', state = 'open', last_outbound_at = $1 where id = $2`,
      [now.toISOString(), threadId],
    );
    await thought(sql, userId, threadId, "queue", "W11 REACTIVATE. Confirmed-history check-in. Auto.");
  } else {
    await sql.query(
      `update agent_threads set workflow = 'W11_REACTIVATE', state = 'held', unread = unread + 1 where id = $1`,
      [threadId],
    );
    await thought(sql, userId, threadId, "queue", "W11 REACTIVATE. Draft check-in, not auto.");
  }
}

export async function markPaid(opts: {
  userId: string;
  offerId: string;
  rail: string;
  externalId: string;
  amountCents: number;
}): Promise<{ ok: boolean; replay?: boolean }> {
  return withTransaction(async (sql) => {
    const result = await applyMarkPaid(sql, opts.userId, opts);
    if (!result.ok) return { ok: false };
    return { ok: true, replay: result.replay };
  });
}
