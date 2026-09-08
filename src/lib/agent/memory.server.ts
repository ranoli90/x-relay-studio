import { getSql } from "@/lib/db";
import { buildFanMemory, extractFacts, serializeMemory, type FanMemory } from "./memory.ts";
import type { DiaryVoice } from "./types.ts";

export async function loadFanNotes(fanId: string, userId: string): Promise<string | null> {
  const sql = await getSql();
  const row = (
    await sql.query<{ notes: string | null }>(`select notes from agent_fans where id = $1 and user_id = $2`, [
      fanId,
      userId,
    ])
  )[0];
  return row?.notes ?? null;
}

export async function saveFanMemory(fanId: string, mem: FanMemory, userId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(`update agent_fans set notes = $1 where id = $2 and user_id = $3`, [
    serializeMemory(mem),
    fanId,
    userId,
  ]);
}

export async function rememberFan(opts: {
  fanId: string;
  inbound: string;
  diary: { voice: DiaryVoice; body: string }[];
  last: { role: string; body: string }[];
  lifetimeCents: number;
  userId: string;
}): Promise<FanMemory> {
  const stored = await loadFanNotes(opts.fanId, opts.userId);
  const mem = buildFanMemory({
    inbound: opts.inbound,
    diary: opts.diary,
    last: opts.last,
    lifetimeCents: opts.lifetimeCents,
    stored,
  });
  try {
    await saveFanMemory(opts.fanId, mem, opts.userId);
  } catch {
    /* never break inbound */
  }
  try {
    const { recordScopedFact } = await import("@/lib/operator/persist.server");
    const facts = extractFacts(opts.inbound);
    for (const [predicate, value] of Object.entries(facts)) {
      if (value === undefined || value === false || value === "") continue;
      await recordScopedFact({
        userId: opts.userId,
        customerId: opts.fanId,
        subject: "partner",
        predicate,
        value: String(value),
        speaker: "customer",
        assertion: "asserted",
        confidence: 0.7,
      });
    }
  } catch {
    /* scoped facts must never block inbound */
  }
  return mem;
}
