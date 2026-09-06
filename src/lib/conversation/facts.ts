import { isNegated, isQuoted, isQuestion, normalizeAnalysisText } from "./text.ts";

export type FactSubjectKind = "persona" | "partner" | "third_party" | "relationship";
export type FactAssertion = "asserted" | "negated" | "question" | "quoted" | "hypothetical" | "operator_attested";
export type FactStatus = "proposed" | "accepted" | "uncertain" | "retracted" | "superseded";

export type ProposedFact = {
  subject: FactSubjectKind;
  predicate: "pet" | "job" | "city" | "name" | "likes" | "burned" | "price_sensitive" | "other";
  value: string;
  assertion: FactAssertion;
  confidence: number;
  thirdParty?: boolean;
};

export type StoredFact = ProposedFact & {
  id: string;
  status: FactStatus;
  observedAt: string;
  sourceVoice?: "HIM" | "ME" | "US" | "inbound";
  supersedes?: string | null;
};

const PET_NAMED =
  /\b(?:my )?(?:dog|cat|puppy|kitten)\s+(?:(?:is|was)\s+)?(?:named|called)\s+([A-Za-z][A-Za-z']{1,16})\b/i;
const PET_IS = /\b(?:my )?(?:dog|cat|puppy|kitten)\s+is\s+([A-Z][a-z]{1,16})\b/;
const JOB = /\b(?:i work (?:at|as)|i'm a|im a|i am a|my job is)\s+(.{2,40})/i;
const CITY =
  /\b(?:i (?:live|moved) (?:in|to)|i['’]m in|im in|i am in|from)\s+([A-Za-z][A-Za-z]+(?:\s+[A-Za-z][A-Za-z]+)?)/i;
const NAME = /\b(?:my name is|i'm|im|i am|this is|call me)\s+([A-Z][a-z]{1,16})\b/;
const THIRD = /\b(my (sister|brother|friend|mom|dad|wife|husband|roommate)|she|he) (?:has|have|got)\b/i;
const FEELING = /^(tired|fine|good|ok|okay|here|just|not|so|the|into|looking)$/i;
const DEAD_PET = /\b(died|dead|passed|put down)\b/i;

export function classifyAssertion(text: string): FactAssertion {
  if (isQuestion(text)) return "question";
  if (isQuoted(text)) return "quoted";
  if (isNegated(text)) return "negated";
  if (/\b(if|would|might|maybe)\b/i.test(text)) return "hypothetical";
  return "asserted";
}

export function extractProposedFacts(
  text: string,
  opts: { voice?: "HIM" | "ME" | "US" | "inbound"; speaker?: FactSubjectKind } = {},
): ProposedFact[] {
  const raw = text.trim();
  if (!raw) return [];
  const voice = opts.voice ?? "inbound";
  if (voice === "ME" || voice === "US") return [];

  const clauses = raw.split(/[,.;]+/).map((c) => c.trim()).filter(Boolean);
  const parts = clauses.length ? clauses : [raw];
  const out: ProposedFact[] = [];
  for (const part of parts) {
    out.push(...extractFromClause(part, opts.speaker ?? "partner"));
  }
  return out;
}

function extractFromClause(raw: string, subject: FactSubjectKind): ProposedFact[] {
  const analysis = normalizeAnalysisText(raw);
  if (!analysis) return [];
  const assertion = classifyAssertion(analysis);
  const thirdParty = THIRD.test(analysis);
  const out: ProposedFact[] = [];

  const push = (predicate: ProposedFact["predicate"], value: string, extra?: Partial<ProposedFact>) => {
    const v = value.replace(/[.!?].*$/, "").trim().slice(0, 40);
    if (!v) return;
    out.push({
      subject: extra?.subject ?? subject,
      predicate,
      value: v,
      assertion: extra?.assertion ?? assertion,
      confidence: extra?.confidence ?? (assertion === "asserted" && !thirdParty ? 0.8 : 0.3),
      thirdParty: extra?.thirdParty ?? thirdParty,
    });
  };

  if (DEAD_PET.test(analysis) && /\b(dog|cat|pet)\b/i.test(analysis)) return out;

  const pet = PET_NAMED.exec(analysis) || PET_IS.exec(raw) || PET_NAMED.exec(raw);
  if (pet?.[1] && !/^died$/i.test(pet[1]) && !FEELING.test(pet[1])) {
    const name = pet[1].replace(/^./, (c) => c.toUpperCase());
    push("pet", name, thirdParty ? { subject: "third_party", thirdParty: true, confidence: 0.2 } : undefined);
  }

  const job = JOB.exec(analysis);
  if (job?.[1] && assertion !== "question") push("job", job[1]);

  const city = CITY.exec(raw) || CITY.exec(analysis);
  if (city?.[1]) {
    const name = city[1].replace(/\b\w/g, (c) => c.toUpperCase());
    push("city", name);
  }

  const name = NAME.exec(raw);
  if (name?.[1] && !FEELING.test(name[1]) && assertion === "asserted" && !isQuoted(raw)) {
    push("name", name[1]);
  }

  if (/\b(got burned|last girl|she took (the )?money|scammed)\b/i.test(analysis) && assertion === "asserted") {
    push("burned", "true");
  }
  if (/\b(too expensive|too much|cheaper|broke)\b/i.test(analysis) && assertion === "asserted") {
    push("price_sensitive", "true");
  }
  if (/\b(don't want|do not want|not interested in)\b/i.test(analysis)) {
    const like = analysis.match(/\b(gfe|sexting|video call|custom|dropbox)\b/i);
    if (like) push("likes", like[1].toLowerCase(), { assertion: "negated", confidence: 0.7 });
  } else if (/\b(gfe|sext|video call|custom|dropbox)\b/i.test(analysis) && assertion === "asserted") {
    const like = analysis.match(/\b(gfe|sexting|video call|custom|dropbox)\b/i);
    if (like) push("likes", like[1].toLowerCase());
  }

  return out;
}

export function usablePartnerFacts(facts: StoredFact[]): Record<string, string> {
  const accepted = facts
    .filter((f) => f.subject === "partner")
    .filter((f) => f.status === "accepted")
    .filter((f) => f.assertion === "asserted" || f.assertion === "operator_attested")
    .filter((f) => !f.thirdParty);
  const byPred = new Map<string, StoredFact>();
  const sorted = [...accepted].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  for (const f of sorted) byPred.set(f.predicate, f);
  const out: Record<string, string> = {};
  for (const [k, v] of byPred) out[k] = v.value;
  return out;
}

/** Apply facts oldest-first so a later correction wins. */
export function applyFactEvents(existing: StoredFact[], incoming: ProposedFact[], at: string): StoredFact[] {
  const next = [...existing];
  for (const p of incoming) {
    if (p.assertion !== "asserted" && p.assertion !== "negated" && p.assertion !== "operator_attested") {
      next.push({
        ...p,
        id: `prop_${next.length}`,
        status: p.assertion === "question" || p.assertion === "quoted" ? "uncertain" : "proposed",
        observedAt: at,
      });
      continue;
    }
    const prevIdx = next.findIndex(
      (f) =>
        f.subject === p.subject &&
        f.predicate === p.predicate &&
        f.status === "accepted" &&
        (p.assertion !== "negated" || f.value.toLowerCase() === p.value.toLowerCase()),
    );
    if (p.assertion === "negated") {
      if (prevIdx >= 0) {
        const prev = next[prevIdx]!;
        next[prevIdx] = { ...prev, status: "retracted" };
      }
      next.push({ ...p, id: `neg_${next.length}`, status: "accepted", observedAt: at, supersedes: next[prevIdx]?.id });
      continue;
    }
    if (prevIdx >= 0) {
      const prev = next[prevIdx]!;
      if (at < prev.observedAt) continue;
      if (prev.value.toLowerCase() === p.value.toLowerCase()) continue;
      next[prevIdx] = { ...prev, status: "superseded" };
      next.push({
        ...p,
        id: `fact_${next.length}`,
        status: "accepted",
        observedAt: at,
        supersedes: prev.id,
      });
    } else {
      next.push({ ...p, id: `fact_${next.length}`, status: "accepted", observedAt: at });
    }
  }
  return next;
}

export type LegacyNotes = {
  wants?: unknown;
  needs?: unknown;
  vibe?: unknown;
  facts?: unknown;
  notes?: unknown;
  lastPaidCents?: unknown;
  rejects?: unknown;
  ghosts?: unknown;
};

export function parseLegacyNotes(raw: string | null | undefined): {
  notes: string[];
  lastPaidCents: number;
  rejects: number;
  ghosts: number;
  vibe: "sweet" | "direct" | "playful" | "quiet" | null;
  wants: string | null;
  needs: string | null;
  quarantined: boolean;
} {
  const empty = {
    notes: [] as string[],
    lastPaidCents: 0,
    rejects: 0,
    ghosts: 0,
    vibe: null as "sweet" | "direct" | "playful" | "quiet" | null,
    wants: null as string | null,
    needs: null as string | null,
    quarantined: false,
  };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as LegacyNotes;
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      return { ...empty, notes: [String(raw).slice(0, 140)], quarantined: true };
    }
    const notes = Array.isArray(v.notes)
      ? v.notes.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 200))
      : [];
    const vibe =
      v.vibe === "sweet" || v.vibe === "direct" || v.vibe === "playful" || v.vibe === "quiet" ? v.vibe : null;
    return {
      notes,
      lastPaidCents: typeof v.lastPaidCents === "number" && Number.isFinite(v.lastPaidCents) ? v.lastPaidCents : 0,
      rejects: typeof v.rejects === "number" ? v.rejects : 0,
      ghosts: typeof v.ghosts === "number" ? v.ghosts : 0,
      vibe,
      wants: typeof v.wants === "string" ? v.wants : null,
      needs: typeof v.needs === "string" ? v.needs : null,
      quarantined: false,
    };
  } catch {
    return { ...empty, notes: [raw.slice(0, 140)], quarantined: true };
  }
}
