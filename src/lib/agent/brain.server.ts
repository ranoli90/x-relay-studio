import { getSql } from "@/lib/db";
import { newId } from "./ids.ts";
import { runSafety, SAFETY_REFUSALS, safetyBlocksGenerate } from "./safety.ts";
import { understandLocal } from "./understand.ts";
import { buildPlan, routeWorkflow } from "./route.ts";
import { writeWithGateway } from "./gateway.server.ts";
import { clockLabel, hourInZone } from "./clock.ts";
import { findSku } from "./catalog.ts";
import { goldSummary } from "./eval.ts";
import { writeLocal } from "./write.ts";
import { ensureSeed } from "./seed.server.ts";
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

function iso(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
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

export async function processInbound(opts: {
  userId: string;
  threadId?: string;
  fanId?: string;
  text: string;
  idempotencyKey?: string;
  source?: Source;
}): Promise<{ threadId: string; workflow: WorkflowId; held: boolean; killed: boolean }> {
  const sql = await getSql();
  const personaId = await ensureSeed(opts.userId);

  if (opts.idempotencyKey) {
    try {
      await sql.query(
        `insert into agent_idempotency (id, user_id, key) values ($1,$2,$3)`,
        [newId("idm"), opts.userId, opts.idempotencyKey],
      );
    } catch {
      const existing = await sql.query<{ thread_id: string; workflow: string }>(
        `select t.id as thread_id, t.workflow from agent_threads t
          join agent_fans f on f.id = t.fan_id
         where t.user_id = $1
         order by t.last_inbound_at desc nulls last limit 1`,
        [opts.userId],
      );
      return {
        threadId: opts.threadId ?? existing[0]?.thread_id ?? "",
        workflow: (existing[0]?.workflow as WorkflowId) ?? "W1_INGEST",
        held: true,
        killed: false,
      };
    }
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
    }>(
      `select id, display_name, bible, timezone, auto_send, quiet_start, quiet_end
         from agent_personas where id = $1`,
      [personaId],
    )
  )[0];
  if (!persona) throw new Error("persona missing");

  let threadId = opts.threadId;
  let fanId = opts.fanId;
  if (threadId) {
    const row = (
      await sql.query<{ fan_id: string; user_id: string }>(
        `select fan_id, user_id from agent_threads where id = $1 and user_id = $2`,
        [threadId, opts.userId],
      )
    )[0];
    if (!row) throw new Error("thread not found");
    fanId = row.fan_id;
  } else {
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
    }>(
      `select display_name, source, archetype, lifetime_cents, trust from agent_fans
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
    }>(
      `select takeover, workflow, last_inbound_at, last_outbound_at from agent_threads
        where id = $1`,
      [threadId],
    )
  )[0];

  const now = new Date();
  await sql.query(
    `insert into agent_messages (id, user_id, thread_id, role, body, status)
     values ($1,$2,$3,'fan',$4,'sent')`,
    [newId("msg"), opts.userId, threadId, opts.text],
  );
  await sql.query(
    `update agent_threads set last_inbound_at = $1, unread = unread + 1 where id = $2`,
    [now.toISOString(), threadId],
  );
  await thought(sql, opts.userId, threadId, "ingest", `W1 INGEST. Normalized. Idempotent key attached.`);

  const safety = runSafety(opts.text);
  await thought(sql, opts.userId, threadId, "safety", `W2 SAFETY ${safety.verdict}. ${safety.note}`);

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
    return { threadId, workflow: "W15_HANDOFF", held: true, killed };
  }

  const countRows = await sql.query<{ n: number }>(
    `select count(*)::int as n from agent_messages where thread_id = $1 and role in ('fan','persona')`,
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
    await sql.query<{ held: number }>(
      `select held from agent_seats where persona_id = $1 and kind = 'gfe'`,
      [personaId],
    )
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
  const autoEnabled = Boolean(persona.auto_send) && gold.autoSendAllowed;

  const workflow = routeWorkflow(safety, u, {
    lifetimeCents: fan.lifetime_cents,
    turns,
    takeover: Boolean(thread.takeover),
    justDelivered: Number(justDelivered?.n ?? 0) > 0,
    silentDays,
    gfeHeld: Number(gfeHeld?.held ?? 0) > 0,
    overflow: Number(openCount?.n ?? 0) > 20,
    whale: fan.lifetime_cents >= 20000 || u.archetype === "whale",
    firstOfferSent: Number(firstOffer?.n ?? 0) > 0,
  });
  const plan = buildPlan(workflow, u, {
    lifetimeCents: fan.lifetime_cents,
    turns,
    takeover: Boolean(thread.takeover),
    justDelivered: Number(justDelivered?.n ?? 0) > 0,
    silentDays,
    gfeHeld: Number(gfeHeld?.held ?? 0) > 0,
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
  const hour = hourInZone(now, persona.timezone);
  await thought(sql, opts.userId, threadId, "clock", `W18 LIFE-CLOCK ${clockLabel(hour, clock)}`);

  if (safety.verdict === "refuse") {
    const code = safety.codes[0] ?? "irl";
    const line = SAFETY_REFUSALS[code] ?? SAFETY_REFUSALS.irl;
    await sql.query(
      `insert into agent_messages (id, user_id, thread_id, role, body, workflow, status)
       values ($1,$2,$3,'draft',$4,$5,'held')`,
      [newId("msg"), opts.userId, threadId, line, workflow],
    );
    await sql.query(
      `update agent_threads set workflow = $1, state = 'held' where id = $2`,
      [workflow, threadId],
    );
    await thought(sql, opts.userId, threadId, "write", "Refuse draft. Writer skipped on safety.");
    return { threadId, workflow, held: true, killed: false };
  }

  if (thread.takeover) {
    await sql.query(
      `update agent_threads set workflow = 'W15_HANDOFF', state = 'handoff' where id = $1`,
      [threadId],
    );
    await thought(sql, opts.userId, threadId, "handoff", "Takeover on. AI paused.");
    return { threadId, workflow: "W15_HANDOFF", held: true, killed: false };
  }

  if (workflow === "W15_HANDOFF") {
    await sql.query(
      `update agent_threads set workflow = 'W15_HANDOFF', state = 'handoff', takeover = true where id = $1`,
      [threadId],
    );
    await thought(sql, opts.userId, threadId, "handoff", "Handoff workflow. Writer skipped.");
    return { threadId, workflow: "W15_HANDOFF", held: true, killed: false };
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
  const last = await sql.query<{ role: string; body: string }>(
    `select role, body from agent_messages
      where thread_id = $1 and role in ('fan','persona')
      order by created_at desc limit 20`,
    [threadId],
  );

  if (workflow === "W7_GFE") {
    await sql.query(
      `update agent_seats set held = least(capacity, held + 1), updated_at = now()
        where persona_id = $1 and kind = 'gfe' and held < capacity`,
      [personaId],
    );
    await thought(sql, opts.userId, threadId, "plan", "GFE seat held. First contract stays human.");
  }

  let proofReady = false;
  if (workflow === "W13_PROOF") {
    const asset = (
      await sql.query<{ id: string; label: string }>(
        `select id, label from agent_proof_assets
          where persona_id = $1 and used_fan_id is null and live = false
          limit 1`,
        [personaId],
      )
    )[0];
    if (asset) {
      await sql.query(`update agent_proof_assets set used_fan_id = $1 where id = $2`, [fanId, asset.id]);
      await thought(sql, opts.userId, threadId, "plan", `Proof reserved: ${asset.label}. 1 asset / fan.`);
    }
    proofReady = Boolean(asset);
  }

  const written = await writeWithGateway(opts.userId, threadId, {
    plan,
    personaName: persona.display_name,
    bible: persona.bible,
    clock,
    hour,
    diary,
    last: last.reverse(),
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

  // Draft-only: never label a local save as sent. Human send is a different path.
  const auto = false;
  const state: ThreadState = "held";

  if (written.bubbles.length === 0) {
    await sql.query(
      `update agent_threads set workflow = $1, state = 'held' where id = $2`,
      [workflow, threadId],
    );
    return { threadId, workflow, held: true, killed: false };
  }

  const sku = findSku(catalogRows, plan.sku);
  let offerId: string | null = null;
  if (sku && (workflow === "W6_CLOSE_NOW" || workflow === "W4_QUALIFY" || workflow === "W8_OFFER")) {
    offerId = newId("off");
    await sql.query(
      `insert into agent_offers (id, user_id, persona_id, fan_id, thread_id, sku, price_cents, status)
       values ($1,$2,$3,$4,$5,$6,$7,'sent')`,
      [offerId, opts.userId, personaId, fanId, threadId, sku.sku, sku.priceCents],
    );
  }

  for (const bubble of written.bubbles) {
    await sql.query(
      `insert into agent_messages
        (id, user_id, thread_id, role, body, workflow, offer_id, auto, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        newId("msg"),
        opts.userId,
        threadId,
        auto ? "persona" : "draft",
        bubble,
        workflow,
        offerId,
        auto,
        auto ? "sent" : "held",
      ],
    );
  }

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

  await thought(sql, opts.userId, threadId, "desk", "W19 DESK. Thought + diary only. Never to buyer.");

  return { threadId, workflow, held: !auto, killed: false };
}

function diaryPatch(intent: string, text: string): string | null {
  if (intent === "greeting") return null;
  const clipped = text.trim().slice(0, 140);
  if (clipped.length < 8) return null;
  return clipped;
}

export async function tickAgentJobs(userId?: string): Promise<number> {
  const sql = await getSql();
  const due = userId
    ? await sql.query<{ id: string; user_id: string; thread_id: string | null; kind: string }>(
        `select id, user_id, thread_id, kind from agent_jobs
          where done_at is null and run_at <= now() and user_id = $1
          limit 20`,
        [userId],
      )
    : await sql.query<{ id: string; user_id: string; thread_id: string | null; kind: string }>(
        `select id, user_id, thread_id, kind from agent_jobs
          where done_at is null and run_at <= now()
          limit 20`,
      );
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
          await sql.query(
            `insert into agent_tickets (id, user_id, thread_id, offer_id, kind, body)
             values ($1,$2,$3,$4,'sla','PAID offer not delivered in 10 minutes.')`,
            [newId("tix"), job.user_id, job.thread_id, pending.id],
          );
          await thought(
            sql,
            job.user_id,
            job.thread_id,
            "handoff",
            "W9 FULFILL watchdog. PAID still sitting. Ticket for operator.",
          );
        }
      } else if (job.kind === "check_in" && job.thread_id) {
        await runCheckIn(sql, job.user_id, job.thread_id);
      }
    } catch (err) {
      console.info("[agent]", { event: "job_fail", id: job.id, err: String(err).slice(0, 120) });
      await sql.query(
        `update agent_jobs
            set status = 'retry_wait',
                attempt_count = coalesce(attempt_count, 0) + 1,
                last_error = $2,
                run_at = now() + interval '2 minutes'
          where id = $1 and done_at is null`,
        [job.id, String(err).slice(0, 240)],
      );
      continue;
    }
    await sql.query(
      `update agent_jobs set done_at = now(), status = 'succeeded' where id = $1 and done_at is null`,
      [job.id],
    );
    n += 1;
  }
  return n;
}

type Sql = Awaited<ReturnType<typeof getSql>>;

async function runCheckIn(sql: Sql, userId: string, threadId: string) {
  const thread = (
    await sql.query<{
      takeover: boolean;
      last_outbound_at: string | Date | null;
      fan_id: string;
      persona_id: string;
    }>(
      `select takeover, last_outbound_at, fan_id, persona_id from agent_threads
        where id = $1 and user_id = $2`,
      [threadId, userId],
    )
  )[0];
  if (!thread || thread.takeover) return;
  if (thread.last_outbound_at) {
    const age = Date.now() - new Date(iso(thread.last_outbound_at) ?? 0).getTime();
    if (age < 3 * 3600_000) return;
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
    await sql.query<{ display_name: string; bible: string; timezone: string }>(
      `select display_name, bible, timezone from agent_personas where id = $1`,
      [thread.persona_id],
    )
  )[0];
  const fan = (
    await sql.query<{ display_name: string; lifetime_cents: number; archetype: string; source: string }>(
      `select display_name, lifetime_cents, archetype, source from agent_fans where id = $1`,
      [thread.fan_id],
    )
  )[0];
  if (!persona || !fan) return;

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
  const last = await sql.query<{ role: string; body: string }>(
    `select role, body from agent_messages
      where thread_id = $1 and role in ('fan','persona')
      order by created_at desc limit 20`,
    [threadId],
  );
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
    turns: last.length,
    takeover: false,
    justDelivered: false,
    silentDays: 6,
    gfeHeld: false,
    overflow: false,
    whale: fan.lifetime_cents >= 20000,
    firstOfferSent: true,
  };
  const plan = buildPlan("W11_REACTIVATE", u, ctx, false);
  const hour = hourInZone(new Date(), persona.timezone);
  const written = writeLocal({
    plan,
    personaName: persona.display_name,
    bible: persona.bible,
    clock,
    hour,
    diary,
    last: last.reverse(),
    catalog: catalogRows,
    fanName: fan.display_name,
    inbound: "",
  });
  if (written.bubbles.length === 0) return;
  for (const bubble of written.bubbles) {
    await sql.query(
      `insert into agent_messages (id, user_id, thread_id, role, body, workflow, status)
       values ($1,$2,$3,'draft',$4,'W11_REACTIVATE','held')`,
      [newId("msg"), userId, threadId, bubble],
    );
  }
  await sql.query(
    `update agent_threads set workflow = 'W11_REACTIVATE', state = 'held', unread = unread + 1 where id = $1`,
    [threadId],
  );
  await thought(sql, userId, threadId, "queue", "W11 REACTIVATE. One memory callback. Draft, not auto.");
}

export async function markPaid(opts: {
  userId: string;
  offerId: string;
  rail: string;
  externalId: string;
  amountCents: number;
}): Promise<{ ok: boolean }> {
  const sql = await getSql();
  const offer = (
    await sql.query<{ id: string; thread_id: string; fan_id: string; user_id: string; status: string }>(
      `select id, thread_id, fan_id, user_id, status from agent_offers where id = $1 and user_id = $2`,
      [opts.offerId, opts.userId],
    )
  )[0];
  if (!offer) return { ok: false };
  const existingPay = (
    await sql.query<{ id: string }>(
      `select id from agent_payments where rail = $1 and external_id = $2 limit 1`,
      [opts.rail, opts.externalId],
    )
  )[0];
  if (!existingPay) {
    await sql.query(
      `insert into agent_payments (id, user_id, offer_id, rail, amount_cents, status, external_id, paid_at)
       values ($1,$2,$3,$4,$5,'paid',$6,now())`,
      [newId("pay"), opts.userId, offer.id, opts.rail, opts.amountCents, opts.externalId],
    );
  }
  await sql.query(
    `update agent_offers set status = 'paid', paid_at = now() where id = $1`,
    [offer.id],
  );
  await sql.query(
    `update agent_fans set lifetime_cents = lifetime_cents + $1, trust = least(100, trust + 8) where id = $2`,
    [opts.amountCents, offer.fan_id],
  );
  await sql.query(
    `update agent_threads set workflow = 'W9_FULFILL', state = 'fulfilling' where id = $1`,
    [offer.thread_id],
  );
  const runAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await sql.query(
    `insert into agent_jobs (id, user_id, thread_id, kind, run_at, payload)
     values ($1,$2,$3,'fulfillment',$4,$5)`,
    [newId("job"), opts.userId, offer.thread_id, runAt, JSON.stringify({ offerId: offer.id })],
  );
  return { ok: true };
}
