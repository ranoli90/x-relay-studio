import * as agentFns from "@/lib/agent/fns";
import type {
  DeskSnapshot,
  OperatorMessage,
  OperatorThread,
  ThreadSnapshot,
  WorkflowId,
} from "@/lib/agent/types";

export const TONES = ["sage", "sand", "ink", "clay", "mist"] as const;
export type Tone = (typeof TONES)[number];

export type RosterRow = {
  name: string;
  tone: string;
  live: boolean;
  threadCount: number;
};

export type ActivityKind =
  | "inbound"
  | "typing"
  | "sent"
  | "held"
  | "handoff"
  | "killed"
  | "failed";

export type ActivityRow = {
  id: string;
  agentName: string;
  kind: string;
  body: string;
  threadId: string | null;
  createdAt: string;
};

type PersonaExtra = DeskSnapshot["persona"] & {
  backgroundRun?: boolean;
  agentName?: string;
};

export type FloorDesk = DeskSnapshot & {
  persona: PersonaExtra;
  roster?: RosterRow[];
  activity?: ActivityRow[];
};

export type FloorThread = OperatorThread & { agentName?: string | null };
export type FloorMessage = OperatorMessage & { agentName?: string | null };

const HELD_STATES = new Set(["held", "handoff", "killed"]);

export function asFloorDesk(raw: DeskSnapshot): FloorDesk {
  return raw as FloorDesk;
}

export function personaName(desk: FloorDesk | null | undefined): string {
  return desk?.persona.displayName || desk?.persona.agentName || "Agent";
}

export function backgroundRunOf(desk: FloorDesk | null | undefined): boolean {
  return Boolean(desk?.persona.backgroundRun);
}

export function deskRoster(desk: FloorDesk): RosterRow[] {
  if (Array.isArray(desk.roster) && desk.roster.length > 0) return desk.roster;
  return [
    {
      name: personaName(desk),
      tone: "ink",
      live: Boolean(desk.persona.autoSend && desk.persona.backgroundRun),
      threadCount: desk.threads.length,
    },
  ];
}

export function deskActivity(desk: FloorDesk): ActivityRow[] {
  return Array.isArray(desk.activity) ? desk.activity : [];
}

export function threadAgent(thread: OperatorThread | FloorThread | null | undefined): string | null {
  if (!thread) return null;
  const name = (thread as FloorThread).agentName;
  return name ?? null;
}

export function messageAgent(message: OperatorMessage | FloorMessage): string | null {
  const name = (message as FloorMessage).agentName;
  return name ?? null;
}

export function toneOf(raw: string | undefined | null): Tone {
  const t = (raw ?? "ink").toLowerCase();
  return (TONES as readonly string[]).includes(t) ? (t as Tone) : "ink";
}

export function toneAvatarClass(tone: Tone): string {
  switch (tone) {
    case "sage":
      return "bg-tone-sage/20 text-tone-sage";
    case "sand":
      return "bg-tone-sand/20 text-tone-sand";
    case "ink":
      return "bg-tone-ink/15 text-tone-ink";
    case "clay":
      return "bg-tone-clay/20 text-tone-clay";
    case "mist":
      return "bg-tone-mist/20 text-tone-mist";
  }
}

export function wfLabel(id: WorkflowId | string): string {
  return id.replace(/^W\d+_/, "").replaceAll("_", " ");
}

export function sortFloorThreads(threads: OperatorThread[]): FloorThread[] {
  return [...threads].sort((a, b) => {
    const at = a.lastAt ? Date.parse(a.lastAt) : 0;
    const bt = b.lastAt ? Date.parse(b.lastAt) : 0;
    if (bt !== at) return bt - at;
    return Number(b.unread > 0) - Number(a.unread > 0);
  }) as FloorThread[];
}

export function isHeldState(state: string): boolean {
  return HELD_STATES.has(state);
}

export function latestActivityForThread(
  activity: ActivityRow[],
  threadId: string | null | undefined,
): ActivityRow | null {
  if (!threadId) return null;
  return activity.find((row) => row.threadId === threadId) ?? null;
}

export function rosterStatus(
  row: RosterRow,
  activity: ActivityRow[],
): "live" | "idle" | "typing" {
  const latest = activity.find((a) => a.agentName === row.name);
  if (latest?.kind === "typing") return "typing";
  if (latest?.kind === "sent" || latest?.kind === "inbound") return "live";
  if (row.live) return "live";
  return "idle";
}

type ToggleFn = (opts: { data: { on: boolean } }) => Promise<unknown>;

export async function persistBackgroundRun(on: boolean): Promise<"ok" | "missing"> {
  const fn = (agentFns as { setBackgroundRun?: ToggleFn }).setBackgroundRun;
  if (typeof fn !== "function") return "missing";
  await fn({ data: { on } });
  return "ok";
}

export const SCENARIOS: { id: "quick_buy" | "gfe" | "burned" | "real" | "meetup" | "injection" | "minor"; label: string }[] = [
  { id: "quick_buy", label: "Price ask" },
  { id: "gfe", label: "GFE" },
  { id: "burned", label: "Burned" },
  { id: "real", label: "Are you real" },
  { id: "meetup", label: "Meetup" },
  { id: "injection", label: "Injection" },
  { id: "minor", label: "18+ kill" },
];

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

export function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "A";
}

export type FloorSnapshot = ThreadSnapshot & {
  thread: FloorThread;
  messages: FloorMessage[];
};
