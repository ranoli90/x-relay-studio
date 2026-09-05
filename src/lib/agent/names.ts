export const TONES = ["sage", "sand", "ink", "clay", "mist"] as const;
export type AgentTone = (typeof TONES)[number];

export const FIRST_NAMES = [
  "Aria",
  "Blair",
  "Cora",
  "Dahlia",
  "Eden",
  "Faye",
  "Greta",
  "Harlow",
  "Ivy",
  "Jade",
  "Keira",
  "Lila",
  "Maren",
  "Nora",
  "Opal",
  "Piper",
  "Quinn",
  "Reese",
  "Sienna",
  "Tessa",
  "Vera",
  "Wren",
  "Yara",
  "Zara",
  "Sloane",
  "Elodie",
  "Nina",
  "Rowan",
  "Maya",
  "Lena",
  "Iris",
  "Noa",
] as const;

export type RosterPick = { name: string; tone: AgentTone };

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickAgentName(seed: string): string {
  return FIRST_NAMES[hashSeed(seed) % FIRST_NAMES.length]!;
}

export function pickFromRoster(seed: string, names: readonly string[]): string {
  if (names.length === 0) return pickAgentName(seed);
  return names[hashSeed(seed) % names.length]!;
}

export function pickRoster(seed: string, n = 3): RosterPick[] {
  const size = FIRST_NAMES.length;
  const count = Math.max(0, Math.min(n, size));
  const start = hashSeed(seed) % size;
  const step = (hashSeed(`${seed}:step`) % (size - 1)) + 1;
  const out: RosterPick[] = [];
  const used = new Set<number>();
  for (let i = 0; out.length < count && i < size * 2; i++) {
    const idx = (start + i * step) % size;
    if (used.has(idx)) continue;
    used.add(idx);
    out.push({
      name: FIRST_NAMES[idx]!,
      tone: TONES[out.length % TONES.length]!,
    });
  }
  return out;
}

export function slugName(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return s || "agent";
}
