import { getSql } from "@/lib/db";
import { buildFanMemory, serializeMemory, type FanMemory } from "./memory.ts";
import type { DiaryVoice } from "./types.ts";

export async function loadFanNotes(fanId: string): Promise<string | null> {
  const sql = await getSql();
  const row = (await sql.query<{ notes: string | null }>(`select notes from agent_fans where id = $1`, [fanId]))[0];
  return row?.notes ?? null;
}

export async function saveFanMemory(fanId: string, mem: FanMemory): Promise<void> {
  const sql = await getSql();
  await sql.query(`update agent_fans set notes = $1 where id = $2`, [serializeMemory(mem), fanId]);
}

export async function rememberFan(opts: {
  fanId: string;
  inbound: string;
  diary: { voice: DiaryVoice; body: string }[];
  last: { role: string; body: string }[];
  lifetimeCents: number;
}): Promise<FanMemory> {
  const stored = await loadFanNotes(opts.fanId);
  const mem = buildFanMemory({
    inbound: opts.inbound,
    diary: opts.diary,
    last: opts.last,
    lifetimeCents: opts.lifetimeCents,
    stored,
  });
  try {
    await saveFanMemory(opts.fanId, mem);
  } catch {
    /* never break inbound */
  }
  return mem;
}
