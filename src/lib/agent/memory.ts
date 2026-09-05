import type { DiaryVoice } from "./types.ts";
import type { PriceState } from "./pricing.ts";

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
};

const WANT =
  /\b(i want|i'm into|im into|looking for|can you|send me|do you do)\b(.{0,80})/i;

const PET = /\b(?:my )?(?:dog|cat|puppy|kitten)(?:\s+(?:is )?(?:named|called))?\s+([A-Z][a-z]{1,12})\b/;
const PET_LOWER = /\b(?:my )?(?:dog|cat|puppy|kitten)(?:\s+(?:is )?(?:named|called))?\s+([a-z]{2,12})\b/i;
const JOB = /\b(?:i work (?:at|as)|i'm a|im a|my job is)\s+(.{2,40})/i;
const CITY = /\b(?:i live in|i'm in|im in|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/;
const THEIR_NAME = /\b(?:my name is|i'm|im|this is)\s+([A-Z][a-z]{1,16})\b/;

export function emptyMemory(lifetimeCents = 0): FanMemory {
  return {
    wants: null,
    needs: null,
    vibe: "sweet",
    facts: {},
    notes: [],
    price: { lastPaidCents: 0, rejects: 0, ghosts: 0, lifetimeCents },
  };
}

export function extractFacts(text: string): FanFacts {
  const facts: FanFacts = {};
  const pet = PET.exec(text) || PET_LOWER.exec(text);
  if (pet) facts.pet = pet[1].replace(/^./, (c) => c.toUpperCase());
  const job = JOB.exec(text);
  if (job) facts.job = job[1].replace(/[.!?].*$/, "").trim().slice(0, 40);
  const city = CITY.exec(text);
  if (city) facts.city = city[1].trim();
  const name = THEIR_NAME.exec(text);
  if (name && !/^(into|looking|just|not|so|the|here)$/i.test(name[1])) {
    facts.theirName = name[1];
  }
  if (/\b(got burned|last girl|she took (the )?money|scammed)\b/i.test(text)) {
    facts.burned = true;
  }
  if (/\b(too expensive|too much|cheaper|broke)\b/i.test(text)) {
    facts.priceSensitive = true;
  }
  if (/\b(gfe|sext|video call|custom|dropbox)\b/i.test(text)) {
    const like = text.match(/\b(gfe|sexting|video call|custom|dropbox)\b/i);
    if (like) facts.likes = like[1].toLowerCase();
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
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as StoredFanNotes;
    if (v && typeof v === "object") return v;
  } catch {
    /* plain text notes from an older row */
    return { notes: [raw.slice(0, 140)] };
  }
  return {};
}

export function serializeMemory(mem: FanMemory): string {
  const stored: StoredFanNotes = {
    wants: mem.wants,
    needs: mem.needs,
    vibe: mem.vibe,
    facts: mem.facts,
    notes: mem.notes.slice(0, 8),
    lastPaidCents: mem.price.lastPaidCents,
    rejects: mem.price.rejects,
    ghosts: mem.price.ghosts,
  };
  return JSON.stringify(stored);
}

export function inferVibe(inbound: string, last: { role: string; body: string }[]): FanVibe {
  const blob = `${inbound} ${last.map((m) => m.body).join(" ")}`.toLowerCase();
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
  mem.facts = stored.facts ?? {};
  mem.notes = stored.notes ?? [];
  if (typeof stored.lastPaidCents === "number") mem.price.lastPaidCents = stored.lastPaidCents;
  if (typeof stored.rejects === "number") mem.price.rejects = stored.rejects;
  if (typeof stored.ghosts === "number") mem.price.ghosts = stored.ghosts;
  mem.price.lifetimeCents = opts.lifetimeCents;

  const him = opts.diary.filter((d) => d.voice === "HIM").map((d) => d.body);
  const us = opts.diary.filter((d) => d.voice === "US").map((d) => d.body);
  for (const line of [...him, ...us, opts.inbound]) {
    mem.facts = mergeFacts(mem.facts, extractFacts(line));
  }
  mem.notes = [...mem.notes, ...him].filter(Boolean).slice(0, 8);

  const wantHit = WANT.exec(opts.inbound) || him.map((h) => WANT.exec(h)).find(Boolean);
  if (wantHit) mem.wants = (wantHit[2] ?? wantHit[0]).trim().slice(0, 80);

  if (mem.facts.burned) mem.needs = mem.needs ?? "proof he will not get burned";
  else if (/\b(lonely|need company|talk|check in)\b/i.test(`${opts.inbound} ${him.join(" ")}`)) {
    mem.needs = "company / check-ins";
  } else if (mem.facts.likes) {
    mem.needs = mem.facts.likes;
  }

  mem.vibe = inferVibe(opts.inbound, opts.last);
  if (mem.facts.priceSensitive) mem.price.rejects = Math.max(mem.price.rejects, 1);
  if (opts.lifetimeCents > 0 && mem.price.lastPaidCents === 0) {
    mem.price.lastPaidCents = Math.min(opts.lifetimeCents, 8000);
  }
  return mem;
}

export function memoryPromptBlock(name: string, bible: string, mem: FanMemory): string {
  const who =
    mem.facts.theirName ||
    (name && name.toLowerCase() !== "unknown" ? name : "this person");
  const factBits = [
    mem.facts.pet ? `pet=${mem.facts.pet}` : "",
    mem.facts.job ? `job=${mem.facts.job}` : "",
    mem.facts.city ? `city=${mem.facts.city}` : "",
    mem.facts.burned ? "got burned before — do not rush money" : "",
    mem.facts.priceSensitive ? "price-sensitive" : "",
    mem.facts.likes ? `likes=${mem.facts.likes}` : "",
  ].filter(Boolean);
  return [
    `You are Maya. Stay Maya. Bible: ${bible}`,
    `This chat is only with ${who}. Do not mix fans. Do not mention another fan.`,
    mem.wants ? `They want: ${mem.wants}` : "They have not named a want yet.",
    mem.needs ? `They need: ${mem.needs}` : "Need still unknown.",
    factBits.length ? `Facts you already know: ${factBits.join("; ")}` : "No durable facts yet.",
    `Tone for them: ${mem.vibe}. Match it.`,
    "Ask how they are. Use a known fact if you have one. Do not pitch unless they named content.",
    "Never say a photo is $80. Customs start at $25.",
  ].join("\n");
}

export function factHook(mem: FanMemory): string | null {
  if (mem.facts.pet) return mem.facts.pet;
  if (mem.facts.job) return mem.facts.job;
  if (mem.facts.city) return mem.facts.city;
  if (mem.wants) return mem.wants;
  return null;
}
