import type { DiaryVoice, Intent } from "./types.ts";
import type { PriceState } from "./pricing.ts";

export type FanVibe = "sweet" | "direct" | "playful" | "quiet";

export type FanMemory = {
  wants: string | null;
  needs: string | null;
  vibe: FanVibe;
  notes: string[];
  facts: string[];
  avoid: string[];
  price: PriceState;
};

const WANT =
  /\b(i want|i'm into|im into|looking for|can you|send me|do you do)\b(.{0,80})/i;
const NAME = /\b(?:my name(?:'?s| is)|call me)\s+([A-Za-z]{2,20})\b/i;
const PET = /\b(?:my|the)\s+(dog|cat|puppy|kitten)\s+(?:is |named |called )?([A-Za-z]{2,20})\b/i;
const JOB = /\b(?:i work|i'm a|im a|i am a)\s+([a-z0-9 ]{2,40})\b/i;
const BURN = /\b(got burned|last girl|she took (the )?money|scammed)\b/i;
const PRICEY = /\b(too expensive|cheaper|broke|can'?t spend)\b/i;

export function emptyMemory(lifetimeCents = 0): FanMemory {
  return {
    wants: null,
    needs: null,
    vibe: "sweet",
    notes: [],
    facts: [],
    avoid: [],
    price: {
      lastPaidCents: lifetimeCents > 0 ? lifetimeCents : 0,
      rejects: 0,
      ghosts: 0,
      lifetimeCents,
    },
  };
}

export function parseFanNotes(raw: string | null | undefined): FanMemory {
  if (!raw || !raw.trim()) return emptyMemory();
  try {
    const v = JSON.parse(raw) as Partial<FanMemory>;
    const base = emptyMemory(Number(v.price?.lifetimeCents ?? 0));
    return {
      ...base,
      wants: v.wants ?? null,
      needs: v.needs ?? null,
      vibe: v.vibe === "direct" || v.vibe === "playful" || v.vibe === "quiet" ? v.vibe : "sweet",
      notes: Array.isArray(v.notes) ? v.notes.map(String).slice(0, 8) : [],
      facts: Array.isArray(v.facts) ? v.facts.map(String).slice(0, 10) : [],
      avoid: Array.isArray(v.avoid) ? v.avoid.map(String).slice(0, 6) : [],
      price: {
        lastPaidCents: Number(v.price?.lastPaidCents ?? 0),
        rejects: Number(v.price?.rejects ?? 0),
        ghosts: Number(v.price?.ghosts ?? 0),
        lifetimeCents: Number(v.price?.lifetimeCents ?? 0),
      },
    };
  } catch {
    return { ...emptyMemory(), facts: [raw.trim().slice(0, 80)] };
  }
}

export function serializeFanNotes(mem: FanMemory): string {
  return JSON.stringify({
    wants: mem.wants,
    needs: mem.needs,
    vibe: mem.vibe,
    notes: mem.notes.slice(0, 8),
    facts: mem.facts.slice(0, 10),
    avoid: mem.avoid.slice(0, 6),
    price: mem.price,
  });
}

function pushFact(list: string[], value: string): string[] {
  const v = value.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!v) return list;
  const key = v.toLowerCase();
  if (list.some((x) => x.toLowerCase() === key)) return list;
  return [...list, v].slice(-10);
}

export function inferVibe(inbound: string, last: { role: string; body: string }[]): FanVibe {
  const blob = `${inbound} ${last.map((m) => m.body).join(" ")}`.toLowerCase();
  if (/\b(just tell me|how much|menu|rates?)\b/.test(blob)) return "direct";
  if (/\b(lol|lmao|haha)\b/.test(blob)) return "playful";
  if (inbound.trim().split(/\s+/).length <= 3) return "quiet";
  return "sweet";
}

export function absorbInbound(mem: FanMemory, inbound: string, intent?: Intent | string): FanMemory {
  const next: FanMemory = {
    ...mem,
    notes: [...mem.notes],
    facts: [...mem.facts],
    avoid: [...mem.avoid],
    price: { ...mem.price },
  };
  const text = inbound.trim();
  if (!text) return next;

  const name = NAME.exec(text);
  if (name?.[1]) next.facts = pushFact(next.facts, `name ${name[1]}`);
  const pet = PET.exec(text);
  if (pet?.[1] && pet[2]) next.facts = pushFact(next.facts, `${pet[1]} named ${pet[2]}`);
  const job = JOB.exec(text);
  if (job?.[1]) next.facts = pushFact(next.facts, `works ${job[1].trim()}`);

  if (BURN.test(text) || intent === "objection_burned") {
    next.needs = "needs trust";
    next.avoid = pushFact(next.avoid, "rushing money");
    next.facts = pushFact(next.facts, "got burned before");
  }
  if (PRICEY.test(text) || intent === "objection_price") {
    next.needs = next.needs ?? "price sensitive";
    next.price.rejects += 1;
  }

  if (intent === "gfe_ask" || /\bgfe|girlfriend experience\b/i.test(text)) next.wants = "weekly gfe";
  else if (/\bsext/i.test(text)) next.wants = "sexting";
  else if (/\bvideo call|facetime|cam\b/i.test(text)) next.wants = "video call";
  else if (/\bcustom|pic|pics|photo\b/i.test(text)) next.wants = next.wants ?? "custom";

  const wantHit = WANT.exec(text);
  if (wantHit?.[2] && !next.wants) next.wants = wantHit[2].trim().slice(0, 80);
  if (/\b(lonely|need company|check in)\b/i.test(text)) next.needs = next.needs ?? "company / check-ins";

  next.vibe = inferVibe(text, []);
  return next;
}

export function buildFanMemory(opts: {
  inbound: string;
  diary: { voice: DiaryVoice; body: string }[];
  last: { role: string; body: string }[];
  lifetimeCents: number;
  stored?: FanMemory | null;
}): FanMemory {
  const mem = opts.stored ? { ...opts.stored, facts: [...opts.stored.facts] } : emptyMemory(opts.lifetimeCents);
  const him = opts.diary.filter((d) => d.voice === "HIM").map((d) => d.body);
  const us = opts.diary.filter((d) => d.voice === "US").map((d) => d.body);
  mem.notes = [...him, ...us].slice(0, 6);
  for (const line of him) {
    if (line.trim().length >= 6) mem.facts = pushFact(mem.facts, line);
  }
  const merged = absorbInbound(mem, opts.inbound);
  merged.vibe = inferVibe(opts.inbound, opts.last);
  if (opts.lifetimeCents > merged.price.lifetimeCents) merged.price.lifetimeCents = opts.lifetimeCents;
  return merged;
}

export function topFact(mem: FanMemory): string | null {
  return mem.facts[0] ?? mem.notes[0] ?? null;
}

export function memoryPromptBlock(name: string, bible: string, mem: FanMemory): string {
  const who = name && name.toLowerCase() !== "unknown" ? name : "this person";
  return [
    `You are Maya. Stay Maya. Bible: ${bible}`,
    `This chat is only with ${who}. Do not mix fans. Do not invent facts they never said.`,
    mem.wants ? `They want: ${mem.wants}` : "They have not named a want yet.",
    mem.needs ? `They need: ${mem.needs}` : "Need still unknown.",
    mem.facts.length ? `Important facts: ${mem.facts.slice(0, 5).join("; ")}` : "No extra facts yet.",
    mem.avoid.length ? `Avoid: ${mem.avoid.join("; ")}` : "",
    `Tone for them: ${mem.vibe}. Match it. Ask how they are. Do not pitch until they name content.`,
  ]
    .filter(Boolean)
    .join("\n");
}
