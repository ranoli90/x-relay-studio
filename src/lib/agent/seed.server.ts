import { getSql } from "@/lib/db";
import { demoFixturesAllowed } from "@/lib/runtime";
import { newId } from "./ids.ts";
import { pickAgentName, pickFromRoster, pickRoster, slugName, TONES, type AgentTone } from "./names.ts";

function bibleFor(name: string): string {
  return `${name} is a disclosed AI persona with human desk support. No live job, pet, city, or schedule is claimed unless the operator approves it. Does not meet IRL. Never invent prices. Short bubbles.`;
}

type Sql = Awaited<ReturnType<typeof getSql>>;

async function armAutopilot(_sql: Sql, _userId: string, _personaId: string): Promise<void> {
  /* Reads and seeding must not rearm sending or watching. */
}

async function ensureLiveCatalog(sql: Sql, userId: string, personaId: string): Promise<void> {
  const { demoFixturesAllowed } = await import("@/lib/runtime");
  if (!demoFixturesAllowed()) {
    /* Operator-owned offers only. Do not seed a fixed SKU list. */
    return;
  }
  const existing = await sql.query<{ sku: string }>(
    `select sku from agent_catalog where persona_id = $1`,
    [personaId],
  );
  if (existing.length > 0) return;
  void userId;
}

function deskRoster(userId: string, personaName: string): { name: string; tone: AgentTone }[] {
  const picked = pickRoster(userId, 5);
  const out: { name: string; tone: AgentTone }[] = [];
  const seen = new Set<string>();
  const add = (name: string, tone?: AgentTone) => {
    if (seen.has(name) || out.length >= 3) return;
    seen.add(name);
    out.push({ name, tone: tone ?? TONES[out.length % TONES.length]! });
  };
  add(personaName);
  for (const r of picked) add(r.name, r.tone);
  return out;
}

async function seedRoster(
  sql: Sql,
  userId: string,
  personaId: string,
  personaName: string,
): Promise<string[]> {
  const roster = deskRoster(userId, personaName);
  for (const r of roster) {
    try {
      await sql.query(
        `insert into agent_roster (id, user_id, persona_id, name, tone)
         values ($1,$2,$3,$4,$5)
         on conflict (user_id, name) do nothing`,
        [newId("ros"), userId, personaId, r.name, r.tone],
      );
    } catch {
      /* unique */
    }
  }
  const names = roster.map((r) => r.name);
  const unnamed = await sql.query<{ id: string }>(
    `select id from agent_threads where user_id = $1 and agent_name is null`,
    [userId],
  );
  for (const t of unnamed) {
    const name = pickFromRoster(t.id, names);
    await sql.query(`update agent_threads set agent_name = $1 where id = $2`, [name, t.id]);
  }
  return names;
}

async function seedDemoIfEmpty(sql: Sql, userId: string, personaId: string, rosterNames: string[]) {
  if (!demoFixturesAllowed()) return;
  const existing = (
    await sql.query<{ n: number }>(
      `select count(*)::int as n from agent_threads where user_id = $1`,
      [userId],
    )
  )[0];
  if (Number(existing?.n ?? 0) > 0) return;
  await sql.query(
    `insert into agent_proof_assets (id, user_id, persona_id, kind, label, body, live)
     values ($1,$2,$3,'same_outfit','unused same-outfit','dated still, navy hoodie, kitchen light. never sent live.', false)
     on conflict do nothing`,
    [newId("prf"), userId, personaId],
  ).catch(() => undefined);
  await sql.query(
    `insert into agent_proof_assets (id, user_id, persona_id, kind, label, body, live)
     values ($1,$2,$3,'vn','unused VN','15s voice note, warehouse parking lot, dated. one fan only.', false)
     on conflict do nothing`,
    [newId("prf"), userId, personaId],
  ).catch(() => undefined);
  await seedFans(sql, userId, personaId, rosterNames);
}

export async function ensureSeed(userId: string): Promise<string> {
  const sql = await getSql();
  const existingMaya = (
    await sql.query<{ id: string; display_name: string }>(
      `select id, display_name from agent_personas where user_id = $1 and handle = $2 limit 1`,
      [userId, "maya"],
    )
  )[0];
  if (existingMaya) {
    const names = await seedRoster(sql, userId, existingMaya.id, existingMaya.display_name);
    await ensureLiveCatalog(sql, userId, existingMaya.id);
    await seedDemoIfEmpty(sql, userId, existingMaya.id, names);
    await armAutopilot(sql, userId, existingMaya.id);
    return existingMaya.id;
  }

  const existingAny = (
    await sql.query<{ id: string; display_name: string }>(
      `select id, display_name from agent_personas where user_id = $1 order by created_at asc limit 1`,
      [userId],
    )
  )[0];
  if (existingAny) {
    const names = await seedRoster(sql, userId, existingAny.id, existingAny.display_name);
    await ensureLiveCatalog(sql, userId, existingAny.id);
    await seedDemoIfEmpty(sql, userId, existingAny.id, names);
    await armAutopilot(sql, userId, existingAny.id);
    return existingAny.id;
  }

  const displayName = pickAgentName(userId);
  const handle = slugName(displayName);
  const personaId = newId("per");
  await sql.query(
    `insert into agent_personas
      (id, user_id, handle, display_name, bible, timezone, auto_send, background_run)
     values ($1,$2,$3,$4,$5,'America/Denver', false, false)`,
    [personaId, userId, handle, displayName, bibleFor(displayName)],
  );

  const claims: [string, string, number, number][] = [];
  for (const [kind, claim, start, end] of claims) {
    await sql.query(
      `insert into agent_persona_claims (id, user_id, persona_id, kind, claim, start_hour, end_hour)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [newId("clm"), userId, personaId, kind, claim, start, end],
    );
  }

  await sql.query(
    `insert into agent_seats (id, user_id, persona_id, kind, capacity, held)
     values ($1,$2,$3,'gfe', 3, 0)`,
    [newId("seat"), userId, personaId],
  );
  await sql.query(
    `insert into agent_seats (id, user_id, persona_id, kind, capacity, held)
     values ($1,$2,$3,'custom', 4, 0)`,
    [newId("seat"), userId, personaId],
  );

  if (demoFixturesAllowed()) {
    await sql.query(
      `insert into agent_proof_assets (id, user_id, persona_id, kind, label, body, live)
       values ($1,$2,$3,'same_outfit','unused same-outfit','dated still, navy hoodie, kitchen light. never sent live.', false)`,
      [newId("prf"), userId, personaId],
    );
    await sql.query(
      `insert into agent_proof_assets (id, user_id, persona_id, kind, label, body, live)
       values ($1,$2,$3,'vn','unused VN','15s voice note, warehouse parking lot, dated. one fan only.', false)`,
      [newId("prf"), userId, personaId],
    );
  }

  const tactics: [string, string][] = [
    ["one_door_menu", "W4_QUALIFY"],
    ["memory_plus_loop", "W5_DAY_ARC"],
    ["ask_close", "W6_CLOSE_NOW"],
    ["hold_early", "W7_GFE"],
    ["not_her", "W12_OBJECTION"],
  ];
  for (const [name, wf] of tactics) {
    await sql.query(
      `insert into agent_tactics (id, user_id, persona_id, name, workflow, weight)
       values ($1,$2,$3,$4,$5,50)`,
      [newId("tac"), userId, personaId, name, wf],
    );
  }

  const rosterNames = await seedRoster(sql, userId, personaId, displayName);
  if (demoFixturesAllowed()) {
    await seedFans(sql, userId, personaId, rosterNames);
  }
  await armAutopilot(sql, userId, personaId);
  return personaId;
}

async function seedFans(sql: Sql, userId: string, personaId: string, rosterNames: string[]) {
  const now = Date.now();
  let n = 0;

  async function fan(opts: {
    name: string;
    handle: string;
    source: string;
    archetype: string;
    cents: number;
    trust: number;
    workflow: string;
    state: string;
    unread: number;
    lastIn: number;
    lastOut: number | null;
    diary: [string, string][];
    msgs: [string, string][];
    thought: string;
    draft?: string;
    plan: { workflow: string; strategy: string; tactic: string; reason: string; hold: boolean; sku?: string };
    takeover?: boolean;
  }) {
    const fanId = newId("fan");
    const threadId = newId("thr");
    const agentName = rosterNames.length
      ? rosterNames[n % rosterNames.length]!
      : pickAgentName(threadId);
    n += 1;
    await sql.query(
      `insert into agent_fans
        (id, user_id, persona_id, display_name, handle, source, archetype, lifetime_cents, trust)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [fanId, userId, personaId, opts.name, opts.handle, opts.source, opts.archetype, opts.cents, opts.trust],
    );
    await sql.query(
      `insert into agent_threads
        (id, user_id, persona_id, fan_id, workflow, state, takeover, last_inbound_at, last_outbound_at, unread, agent_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        threadId,
        userId,
        personaId,
        fanId,
        opts.workflow,
        opts.state,
        Boolean(opts.takeover),
        new Date(now - opts.lastIn).toISOString(),
        opts.lastOut == null ? null : new Date(now - opts.lastOut).toISOString(),
        opts.unread,
        agentName,
      ],
    );
    for (const [voice, body] of opts.diary) {
      await sql.query(
        `insert into agent_diary (id, user_id, persona_id, fan_id, voice, body) values ($1,$2,$3,$4,$5,$6)`,
        [newId("dia"), userId, personaId, fanId, voice, body],
      );
    }
    let t = now - opts.lastIn - 3_600_000;
    for (const [role, body] of opts.msgs) {
      t += 180_000;
      await sql.query(
        `insert into agent_messages (id, user_id, thread_id, role, body, workflow, status, created_at, agent_name)
         values ($1,$2,$3,$4,$5,$6,'sent',$7,$8)`,
        [
          newId("msg"),
          userId,
          threadId,
          role,
          body,
          opts.workflow,
          new Date(t).toISOString(),
          role === "persona" ? agentName : null,
        ],
      );
    }
    await sql.query(
      `insert into agent_thoughts (id, user_id, thread_id, kind, body) values ($1,$2,$3,'route',$4)`,
      [newId("th"), userId, threadId, opts.thought],
    );
    await sql.query(
      `insert into agent_plans
        (id, user_id, thread_id, workflow, strategy, tactic, offer_id, hold, reason, doors_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        newId("pln"),
        userId,
        threadId,
        opts.plan.workflow,
        opts.plan.strategy,
        opts.plan.tactic,
        null,
        opts.plan.hold,
        opts.plan.reason,
        JSON.stringify(opts.plan.sku ? [opts.plan.sku] : []),
      ],
    );
    if (opts.draft) {
      await sql.query(
        `insert into agent_messages (id, user_id, thread_id, role, body, workflow, status, agent_name)
         values ($1,$2,$3,'draft',$4,$5,'held',$6)`,
        [newId("msg"), userId, threadId, opts.draft, opts.workflow, agentName],
      );
    }
    return { fanId, threadId };
  }

  await fan({
    name: "Eli",
    handle: "eli_r",
    source: "reddit_sugar",
    archetype: "reddit_sugar",
    cents: 0,
    trust: 12,
    workflow: "W4_QUALIFY",
    state: "open",
    unread: 1,
    lastIn: 8 * 60_000,
    lastOut: 40 * 60_000,
    diary: [
      ["HIM", "Night-shift nurse, talks about a cat named Miso."],
      ["ME", "Have not sent anything free past a greeting."],
      ["US", "Three turns. No money. He asked what I look like twice."],
    ],
    msgs: [
      ["fan", "hey you free?"],
      ["persona", "sometimes. depends what for."],
      ["fan", "just talk. send a pic so i know you're real"],
    ],
    thought: "W4 QUALIFY. $0 reddit sugar. Do not work for free. One SKU door.",
    draft:
      "hey — i don't do long free chats. polaroid set is $25 if you actually want to look. otherwise we can leave it.",
    plan: {
      workflow: "W4_QUALIFY",
      strategy: "qualify_not_free",
      tactic: "one_door_menu",
      reason: "Skipping QUALIFY is how the agent works for free.",
      hold: true,
      sku: "polaroid_set",
    },
  });

  const marcus = await fan({
    name: "Marcus",
    handle: "m.k",
    source: "telegram",
    archetype: "buyer",
    cents: 4000,
    trust: 62,
    workflow: "W5_DAY_ARC",
    state: "open",
    unread: 0,
    lastIn: 50 * 60_000,
    lastOut: 20 * 60_000,
    diary: [
      ["HIM", "Paid voice note. Dog is named Duke. Works mornings."],
      ["ME", "Told him Pepper hates the vacuum. True."],
      ["US", "Laughs. Open loop: he was going to send a photo of Duke."],
    ],
    msgs: [
      ["fan", "duke stole my sock again"],
      ["persona", "pepper does that with the vacuum cord. menace."],
      ["fan", "i'll send a pic later"],
    ],
    thought: "W5 DAY-ARC. Paid. Relational. No upsell this turn.",
    plan: {
      workflow: "W5_DAY_ARC",
      strategy: "relational",
      tactic: "memory_plus_loop",
      reason: "Trust up, one fact, one loop.",
      hold: false,
    },
  });

  await fan({
    name: "Jon",
    handle: "jon",
    source: "telegram",
    archetype: "buyer",
    cents: 2500,
    trust: 44,
    workflow: "W6_CLOSE_NOW",
    state: "held",
    unread: 1,
    lastIn: 4 * 60_000,
    lastOut: 2 * 3600_000,
    diary: [
      ["HIM", "Buys sets, hates waiting."],
      ["ME", "Last polaroid already delivered."],
      ["US", "He asked price on a clip."],
    ],
    msgs: [
      ["fan", "how much for a custom clip"],
    ],
    thought: "W6 CLOSE_NOW. Explicit price. One SKU. Draft only.",
    draft: "custom clip is $80. that's the one. want it?",
    plan: {
      workflow: "W6_CLOSE_NOW",
      strategy: "one_sku",
      tactic: "ask_close",
      reason: "One SKU sent. Model cannot invent $15.",
      hold: true,
      sku: "custom_clip",
    },
  });

  await fan({
    name: "Darren",
    handle: "darr",
    source: "telegram",
    archetype: "whale",
    cents: 18000,
    trust: 70,
    workflow: "W7_GFE",
    state: "held",
    unread: 1,
    lastIn: 12 * 60_000,
    lastOut: 3 * 3600_000,
    diary: [
      ["HIM", "Pays. Wants exclusivity language. Travel for work."],
      ["ME", "One GFE seat currently held for him. Contract not signed."],
      ["US", "He named GFE. First contract is human."],
    ],
    msgs: [
      ["fan", "can we do the girlfriend experience this week. i'll pay"],
    ],
    thought: "W7 GFE HOLD. Seat held 1/3. Human on first contract.",
    draft:
      "gfe isn't a vibe, it's a seat. i hold one, we talk terms with me actually reading them. i'm not signing anything in this chat.",
    plan: {
      workflow: "W7_GFE",
      strategy: "gfe_hold",
      tactic: "hold_early",
      reason: "Named GFE. Hold early. Invite after gates. Human on contract.",
      hold: true,
      sku: "gfe_day",
    },
  });

  await fan({
    name: "Chris",
    handle: "c.real",
    source: "telegram",
    archetype: "burned_daddy",
    cents: 0,
    trust: 18,
    workflow: "W13_PROOF",
    state: "held",
    unread: 1,
    lastIn: 6 * 60_000,
    lastOut: null,
    diary: [
      ["HIM", "Got burned last month. Wants live proof."],
      ["ME", "Have an unused same-outfit still. Do not reuse live."],
      ["US", "Are-you-real on first message."],
    ],
    msgs: [
      ["fan", "are you even real or is this a catfish"],
    ],
    thought: "W13 PROOF. Unused asset. Never reuse live.",
    draft: "fair. i've got an unused proof for you, same-outfit, not a recycled live. sending that — not a new custom.",
    plan: {
      workflow: "W13_PROOF",
      strategy: "unused_proof",
      tactic: "same_outfit_or_vn",
      reason: "Are-you-real. One unused proof.",
      hold: true,
    },
  });

  await fan({
    name: "Vic",
    handle: "vic",
    source: "reddit_sugar",
    archetype: "burned_daddy",
    cents: 0,
    trust: 15,
    workflow: "W12_OBJECTION",
    state: "held",
    unread: 1,
    lastIn: 18 * 60_000,
    lastOut: 2 * 3600_000,
    diary: [
      ["HIM", "Last girl took the money. Price-sensitive."],
      ["ME", "Not her. Floor is catalog."],
      ["US", "Got-burned ≠ price. One reframe, one door."],
    ],
    msgs: [
      ["fan", "last girl got me burned, she took the money. why would i pay you"],
    ],
    thought: "W12 OBJECTION. Burned ≠ price. One reframe + one door.",
    draft:
      "yeah. i'm not her, and i don't take money and vanish. polaroid set is $25 if you want a small proof before anything bigger.",
    plan: {
      workflow: "W12_OBJECTION",
      strategy: "reframe_one_door",
      tactic: "not_her",
      reason: "Table hit. One reframe, one door.",
      hold: true,
      sku: "polaroid_set",
    },
  });

  const offerId = newId("off");
  await sql.query(
    `insert into agent_offers (id, user_id, persona_id, fan_id, thread_id, sku, price_cents, status, paid_at, delivered_at)
     values ($1,$2,$3,$4,$5,'voice_note',4000,'delivered',$6,$7)`,
    [
      offerId,
      userId,
      personaId,
      marcus.fanId,
      marcus.threadId,
      new Date(now - 2 * 86400_000).toISOString(),
      new Date(now - 2 * 86400_000 + 8 * 60_000).toISOString(),
    ],
  );
  await sql.query(
    `insert into agent_payments (id, user_id, offer_id, rail, amount_cents, status, external_id, paid_at)
     values ($1,$2,$3,'throne',4000,'paid',$4,$5)`,
    [newId("pay"), userId, offerId, "wh_demo_marcus", new Date(now - 2 * 86400_000).toISOString()],
  );
}
