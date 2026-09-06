import * as agentFns from "@/lib/agent/fns";
import type {
  DeskSnapshot,
  ModelCallRow,
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
const SENT_STATUSES = new Set(["sent", "sent_confirmed", "observed"]);
const WRITER_TASKS = new Set(["write", "hard_write"]);
const EDITABLE_DRAFT = new Set(["held", "draft", "pending", ""]);

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
  const live = floorLive(desk);
  const rows =
    Array.isArray(desk.roster) && desk.roster.length > 0
      ? desk.roster
      : [
          {
            name: personaName(desk),
            tone: "ink",
            live,
            threadCount: desk.threads.length,
          },
        ];
  return rows.map((row) => ({ ...row, live }));
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

export function messageStatusKey(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase();
}

/** Operator-facing delivery label. Unsent states must not read as sent. */
export function messageDeliveryLabel(message: OperatorMessage | FloorMessage): string | null {
  const role = message.role;
  const status = messageStatusKey(message.status);
  if (role === "fan" || role === "system") return null;
  if (status === "dropped") return null;
  if (status === "local" || status === "not_live") return "local only";
  if (status === "uncertain") return "uncertain send";
  if (status === "approved") return "approved — not sent";
  if (status === "held" || status === "draft" || status === "pending") return "held";
  if (status === "fail" || status === "failed") return "failed";
  if (SENT_STATUSES.has(status)) return "sent";
  if (role === "draft") return "held";
  if (role === "persona" && !status) return "uncertain send";
  return status ? status.replaceAll("_", " ") : null;
}

export function isConfirmedSentStatus(status: string | null | undefined): boolean {
  return SENT_STATUSES.has(messageStatusKey(status));
}

export function isEditableDraft(message: OperatorMessage | FloorMessage): boolean {
  if (message.status === "dropped") return false;
  if (message.role !== "draft") return false;
  return EDITABLE_DRAFT.has(messageStatusKey(message.status));
}

export function isFailedCallOutcome(outcome: string | null | undefined): boolean {
  const o = (outcome ?? "").trim().toLowerCase();
  if (!o || o === "ok" || o === "local") return false;
  return true;
}

/** Map stored call outcomes to a non-secret class. Never echo prompt text. */
export function safeCallOutcome(outcome: string | null | undefined): string {
  const o = (outcome ?? "").trim().toLowerCase();
  if (!o) return "unknown";
  if (o === "ok") return "ok";
  if (o === "local") return "local";
  if (o === "fail" || o === "failed") return "failed";
  if (/401|403|unauthorized|missing.?key|no.?key/.test(o)) return "unauthorized";
  if (/402|payment/.test(o)) return "payment required";
  if (/429|rate.?limit/.test(o)) return "rate limited";
  if (/timeout|abort|aborted/.test(o)) return "timeout";
  if (/503|502|500|unavailable|network/.test(o)) return "unavailable";
  if (/empty/.test(o)) return "empty";
  if (/refus|content.?filter/.test(o)) return "refused";
  if (/truncat|max_tokens|length/.test(o)) return "truncated";
  if (/malformed|parse|json/.test(o)) return "malformed";
  return "failed";
}

export function isWriterTask(task: string | null | undefined): boolean {
  return WRITER_TASKS.has((task ?? "").trim().toLowerCase());
}

export function latestWriterCall(desk: FloorDesk | null | undefined): ModelCallRow | null {
  if (!desk?.calls?.length) return null;
  return desk.calls.find((c) => isWriterTask(c.task)) ?? null;
}

export function hasSuccessfulWriter(desk: FloorDesk | null | undefined): boolean {
  const latest = latestWriterCall(desk);
  return Boolean(latest && latest.outcome === "ok");
}

export function failedModelCalls(desk: FloorDesk | null | undefined): ModelCallRow[] {
  if (!desk?.calls?.length) return [];
  return desk.calls.filter((c) => isFailedCallOutcome(c.outcome));
}

export function writerFailed(desk: FloorDesk | null | undefined): boolean {
  const latest = latestWriterCall(desk);
  return Boolean(latest && isFailedCallOutcome(latest.outcome));
}

/** Live pulse: auto-send on, not stopped, and a successful writer exists. */
export function floorLive(desk: FloorDesk | null | undefined): boolean {
  if (!desk) return false;
  if (desk.persona.emergencyStop) return false;
  if (!desk.persona.autoSend) return false;
  if (desk.eval?.total > 0 && !desk.eval.autoSendAllowed) return false;
  if (!hasSuccessfulWriter(desk)) return false;
  return true;
}

export function deskFlagCaption(desk: FloorDesk | null | undefined): string | null {
  if (!desk) return null;
  if (desk.persona.emergencyStop) return "emergency stop";
  const mode = (desk.persona.automationMode ?? "").toLowerCase();
  if (mode === "off") return "automation off";
  if (desk.persona.autoSend && mode !== "draft") return "auto-send";
  return "draft-hold";
}

export function automationCaption(desk: FloorDesk | null | undefined): string {
  if (!desk) return "offline";
  const flag = deskFlagCaption(desk) ?? "draft-hold";
  const bg = desk.persona.emergencyStop
    ? "background held"
    : desk.persona.backgroundRun
      ? "background on"
      : "background off";
  return `${flag} · ${bg}`;
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
  if (!row.live) return "idle";
  const latest = activity.find((a) => a.agentName === row.name);
  if (latest?.kind === "typing") return "typing";
  if (latest?.kind === "sent" || latest?.kind === "inbound") return "live";
  return "live";
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
