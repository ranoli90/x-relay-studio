import type { DiaryVoice } from "./types.ts";
import type { PriceState } from "./pricing.ts";

export type FanVibe = "sweet" | "direct" | "playful" | "quiet";

export type FanMemory = {
  wants: string | null;
  needs: string | null;
  vibe: FanVibe;
  notes: string[];
  price: PriceState;
};

const WANT =
  /\b(i want|i'm into|im into|looking for|can you|send me|do you do)\b(.{0,80})/i;

export function emptyMemory(lifetimeCents = 0): FanMemory {
  return {
    wants: null,
    needs: null,
    vibe: "sweet",
    notes: [],
    price: { lastPaidCents: lifetimeCents > 0 ? lifetimeCents : 0, rejects: 0, ghosts: 0, lifetimeCents },
  };
}

export function inferVibe(inbound: string, last: { role: string; body: string }[]): FanVibe {
  const blob = `${inbound} ${last.map((m) => m.body).join(" ")}`.toLowerCase();
  if (/\b(just tell me|how much|menu|rates?)\b/.test(blob)) return "direct";
  if (/\b(lol|lmao|haha|😏|😂)\b/.test(blob)) return "playful";
  if (inbound.trim().split(/\s+/).length <= 3) return "quiet";
  return "sweet";
}

export function buildFanMemory(opts: {
  inbound: string;
  diary: { voice: DiaryVoice; body: string }[];
  last: { role: string; body: string }[];
  lifetimeCents: number;
}): FanMemory {
  const mem = emptyMemory(opts.lifetimeCents);
  const him = opts.diary.filter((d) => d.voice === "HIM").map((d) => d.body);
  const us = opts.diary.filter((d) => d.voice === "US").map((d) => d.body);
  mem.notes = [...him, ...us].slice(0, 6);

  const wantHit = WANT.exec(opts.inbound) || him.map((h) => WANT.exec(h)).find(Boolean);
  if (wantHit) mem.wants = (wantHit[2] ?? wantHit[0]).trim().slice(0, 80);

  if (/\b(lonely|need company|talk|check in)\b/i.test(`${opts.inbound} ${him.join(" ")}`)) {
    mem.needs = "company / check-ins";
  } else if (/\b(custom|vid|video|clip|pic)\b/i.test(opts.inbound)) {
    mem.needs = "custom content";
  } else if (/\b(gfe|girlfriend|exclusive|weekly)\b/i.test(opts.inbound)) {
    mem.needs = "gfe";
  }

  mem.vibe = inferVibe(opts.inbound, opts.last);

  const paidNote = us.find((b) => /last paid \$(\d+)/i.test(b));
  if (paidNote) {
    const n = Number(/last paid \$(\d+)/i.exec(paidNote)?.[1] ?? 0);
    if (n > 0) mem.price.lastPaidCents = n * 100;
  }
  const rejectNote = us.find((b) => /reject x(\d+)/i.test(b));
  if (rejectNote) {
    mem.price.rejects = Number(/reject x(\d+)/i.exec(rejectNote)?.[1] ?? 0);
  }
  if (opts.lifetimeCents > mem.price.lastPaidCents) {
    mem.price.lastPaidCents = Math.min(opts.lifetimeCents, 8000);
    mem.price.lifetimeCents = opts.lifetimeCents;
  }
  return mem;
}

export function memoryPromptBlock(name: string, bible: string, mem: FanMemory): string {
  const who = name && name.toLowerCase() !== "unknown" ? name : "this person";
  return [
    `You are Maya. Stay Maya. Bible: ${bible}`,
    `This chat is only with ${who}. Do not mix fans.`,
    mem.wants ? `They want: ${mem.wants}` : "They have not named a want yet.",
    mem.needs ? `They need: ${mem.needs}` : "Need still unknown.",
    `Tone for them: ${mem.vibe}. Match it. Do not reset to a generic closer.`,
    mem.notes.length ? `Remembered: ${mem.notes.slice(0, 3).join(" / ")}` : "No extra notes yet.",
  ].join("\n");
}
