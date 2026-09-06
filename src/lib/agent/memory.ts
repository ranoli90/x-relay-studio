import type { DiaryVoice } from "./types.ts";
import type { PriceState } from "./pricing.ts";
import {
  applyFactEvents,
  extractProposedFacts,
  parseLegacyNotes,
  usablePartnerFacts,
  type StoredFact,
} from "../conversation/facts.ts";
import { spokenName } from "../conversation/names.ts";

export type FanVibe = "sweet" | "direct" | "playful" | "quiet";

export type FanFacts = {
  pet?: string;
  job?: string;
  city?: string;
  theirName?: string;
  burned?: boolean;
  priceSensitive?: boolean;
  likes?: string;
};

export type FanMemory = {
  wants: string | null;
  needs: string | null;
  vibe: FanVibe;
  facts: FanFacts;
  notes: string[];
  price: PriceState;
  factLog: StoredFact[];
};

export type StoredFanNotes = {
  wants?: string | null;
  needs?: string | null;
  vibe?: FanVibe;
  facts?: FanFacts;
  notes?: string[];
  lastPaidCents?: number;
  rejects?: number;
  ghosts?: number;
  factLog?: StoredFact[];
};

const WANT =
  /\b(i want|i'm into|im into|looking for|can you|send me|do you do)\b(.{0,80})/i;

export function emptyMemory(lifetimeCents = 0): FanMemory {
  return {
    wants: null,
    needs: null,
    vibe: "sweet",
    facts: {},
    notes: [],
    price: { lastPaidCents: 0, rejects: 0, ghosts: 0, lifetimeCents },
    factLog: [],
  };
}

export function extractFacts(text: string): FanFacts {
  const proposed = extractProposedFacts(text, { voice: "inbound" });
  const facts: FanFacts = {};
  for (const p of proposed) {
    if (p.assertion !== "asserted" || p.thirdParty || p.subject !== "partner") continue;
    if (p.predicate === "pet") facts.pet = p.value;
    if (p.predicate === "job") facts.job = p.value;
    if (p.predicate === "city") facts.city = p.value;
    if (p.predicate === "name") facts.theirName = p.value;
    if (p.predicate === "burned") facts.burned = true;
    if (p.predicate === "price_sensitive") facts.priceSensitive = true;
    if (p.predicate === "likes") facts.likes = p.value;
  }
  return facts;
}

export function mergeFacts(base: FanFacts, extra: FanFacts): FanFacts {
  return {
    pet: extra.pet ?? base.pet,
    job: extra.job ?? base.job,
    city: extra.city ?? base.city,
    theirName: extra.theirName ?? base.theirName,
    burned: extra.burned ?? base.burned,
    priceSensitive: extra.priceSensitive ?? base.priceSensitive,
    likes: extra.likes ?? base.likes,
  };
}

export function parseStoredNotes(raw: string | null | undefined): StoredFanNotes {
  const parsed = parseLegacyNotes(raw);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as StoredFanNotes;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { notes: parsed.notes };
    return {
      wants: parsed.wants,
      needs: parsed.needs,
      vibe: parsed.vibe ?? undefined,
      notes: parsed.notes,
      lastPaidCents: parsed.lastPaidCents,
      rejects: parsed.rejects,
      ghosts: parsed.ghosts,
      factLog: Array.isArray(v.factLog) ? v.factLog : [],
      facts: v.facts && typeof v.facts === "object" && !Array.isArray(v.facts) ? v.facts : {},
    };
  } catch {
    return { notes: parsed.notes };
  }
}

export function serializeMemory(mem: FanMemory): string {
  const stored: StoredFanNotes = {
    wants: mem.wants,
    needs: mem.needs,
    vibe: mem.vibe,
    facts: mem.facts,
    notes: mem.notes.slice(-12),
    lastPaidCents: mem.price.lastPaidCents,
    rejects: mem.price.rejects,
    ghosts: mem.price.ghosts,
    factLog: mem.factLog.slice(-80),
  };
  return JSON.stringify(stored);
}

export function inferVibe(inbound: string, last: { role: string; body: string }[]): FanVibe {
  const partnerOnly = last.filter((m) => m.role === "fan" || m.role === "inbound").map((m) => m.body);
  const blob = `${inbound} ${partnerOnly.join(" ")}`.toLowerCase();
  if (/\b(just tell me|how much|menu|rates?)\b/.test(blob)) return "direct";
  if (/\b(lol|lmao|haha)\b/.test(blob)) return "playful";
  if (inbound.trim().split(/\s+/).length <= 3) return "quiet";
  return "sweet";
}

export function buildFanMemory(opts: {
  inbound: string;
  diary: { voice: DiaryVoice; body: string }[];
  last: { role: string; body: string }[];
  lifetimeCents: number;
  stored?: string | null;
}): FanMemory {
  const mem = emptyMemory(opts.lifetimeCents);
  const stored = parseStoredNotes(opts.stored);
  mem.wants = stored.wants ?? null;
  mem.needs = stored.needs ?? null;
  mem.vibe = stored.vibe ?? "sweet";
  mem.notes = Array.isArray(stored.notes) ? stored.notes.filter((n) => typeof n === "string") : [];
  if (typeof stored.lastPaidCents === "number") mem.price.lastPaidCents = stored.lastPaidCents;
  if (typeof stored.rejects === "number") mem.price.rejects = stored.rejects;
  if (typeof stored.ghosts === "number") mem.price.ghosts = stored.ghosts;
  mem.price.lifetimeCents = opts.lifetimeCents;
  mem.factLog = Array.isArray(stored.factLog) ? stored.factLog : [];

  const chronological = [...opts.diary].reverse();
  let t = 0;
  for (const line of chronological) {
    const proposed = extractProposedFacts(line.body, {
      voice: line.voice,
      speaker: line.voice === "ME" ? "persona" : "partner",
    });
    mem.factLog = applyFactEvents(mem.factLog, proposed, `1970-01-01T00:00:${String(t).padStart(2, "0")}Z`);
    t += 1;
  }
  mem.factLog = applyFactEvents(mem.factLog, extractProposedFacts(opts.inbound, { voice: "inbound" }), new Date().toISOString());

  const usable = usablePartnerFacts(mem.factLog);
  mem.facts = {
    pet: usable.pet,
    job: usable.job,
    city: usable.city,
    theirName: usable.name || (typeof stored.facts?.theirName === "string" ? stored.facts.theirName : undefined),
    burned: usable.burned === "true" ? true : stored.facts?.burned,
    priceSensitive: usable.price_sensitive === "true" ? true : stored.facts?.priceSensitive,
    likes: usable.likes,
  };

  const him = opts.diary.filter((d) => d.voice === "HIM").map((d) => d.body);
  mem.notes = [...mem.notes, ...him].filter((n) => typeof n === "string" && n.trim()).slice(-12);

  const wantHit = WANT.exec(opts.inbound);
  if (wantHit) mem.wants = (wantHit[2] ?? wantHit[0]).trim().slice(0, 80);

  if (mem.facts.burned) mem.needs = mem.needs ?? "proof he will not get burned";
  else if (mem.facts.likes) mem.needs = mem.facts.likes;

  mem.vibe = inferVibe(opts.inbound, opts.last);
  if (mem.facts.priceSensitive) mem.price.rejects = Math.max(mem.price.rejects, 1);
  return mem;
}

export function memoryPromptBlock(personaName: string, bible: string, mem: FanMemory): string {
  const who = mem.facts.theirName || "this person";
  const spoken = spokenName(who);
  const factBits = [
    mem.facts.pet ? `their pet=${mem.facts.pet}` : "",
    mem.facts.job ? `their job=${mem.facts.job}` : "",
    mem.facts.city ? `their city=${mem.facts.city}` : "",
    mem.facts.burned ? "they said they got burned before — do not rush money" : "",
    mem.facts.priceSensitive ? "price-sensitive" : "",
    mem.facts.likes ? `they like=${mem.facts.likes}` : "",
  ].filter(Boolean);
  return [
    `You write as ${personaName}. Bible (character, not live proof): ${bible}`,
    `This chat is only with ${spoken ?? who}. Do not mix partners. Persona facts and partner facts are different.`,
    mem.wants ? `They want: ${mem.wants}` : "They have not named a want yet.",
    factBits.length ? `Accepted partner facts: ${factBits.join("; ")}` : "No durable partner facts yet.",
    `Tone for them: ${mem.vibe}. Match it. A fact may be known without being said.`,
    "Do not invent a job, pet, city, or live activity. Answer identity questions honestly.",
  ].join("\n");
}

export function factHook(mem: FanMemory): string | null {
  if (mem.facts.pet) return mem.facts.pet;
  if (mem.facts.job) return mem.facts.job;
  if (mem.facts.city) return mem.facts.city;
  if (mem.wants) return mem.wants;
  return null;
}
