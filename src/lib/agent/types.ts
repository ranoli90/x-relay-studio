export const WORKFLOWS = [
  "W1_INGEST",
  "W2_SAFETY",
  "W3_TRIAGE",
  "W4_QUALIFY",
  "W5_DAY_ARC",
  "W6_CLOSE_NOW",
  "W7_GFE",
  "W8_OFFER",
  "W9_FULFILL",
  "W10_AFTERCARE",
  "W11_REACTIVATE",
  "W12_OBJECTION",
  "W13_PROOF",
  "W14_MEDIA_IN",
  "W15_HANDOFF",
  "W16_QUEUE",
  "W17_LEARN",
  "W18_LIFE_CLOCK",
  "W19_DESK",
] as const;

export type WorkflowId = (typeof WORKFLOWS)[number];

export type SafetyVerdict = "allow" | "refuse" | "kill" | "handoff";

export type Intent =
  | "greeting"
  | "price_ask"
  | "content_ask"
  | "gfe_ask"
  | "are_you_real"
  | "meetup"
  | "payment_claim"
  | "receipt"
  | "aftercare"
  | "anger"
  | "objection_burned"
  | "objection_price"
  | "silent_return"
  | "custom"
  | "injection"
  | "crisis"
  | "age_probe"
  | "time_waste"
  | "menu"
  | "identity_ask"
  | "opt_out"
  | "other";

export type Archetype =
  | "new"
  | "reddit_sugar"
  | "buyer"
  | "whale"
  | "time_waster"
  | "burned_daddy"
  | "reverse_scam"
  | "custom_client";

export type Source = "telegram" | "reddit_sugar" | "x" | "unknown";

export type DiaryVoice = "HIM" | "ME" | "US";

export type UnderstandResult = {
  intent: Intent;
  objection: "none" | "price" | "burned" | "time" | "trust";
  archetype: Archetype;
  source: Source;
  wantsSku: string | null;
  gfeNamed: boolean;
  mediaKind: "none" | "photo" | "receipt" | "screenshot";
};

export type SafetyResult = {
  verdict: SafetyVerdict;
  codes: string[];
  note: string;
};

export type ReplyPlan = {
  workflow: WorkflowId;
  strategy: string;
  tactic: string;
  offerId: string | null;
  sku: string | null;
  hold: boolean;
  reason: string;
  doors: string[];
  checkInHours: number | null;
  autonomy: "auto" | "draft";
};

export type CatalogRow = {
  id: string;
  sku: string;
  title: string;
  priceCents: number;
  rail: string;
  eligibility: string;
};

export type ClockSlot = {
  kind: string;
  claim: string;
  startHour: number | null;
  endHour: number | null;
};

export type WriteInput = {
  plan: ReplyPlan;
  personaName: string;
  bible: string;
  clock: ClockSlot[];
  hour: number;
  diary: { voice: DiaryVoice; body: string }[];
  last: { role: string; body: string }[];
  catalog: CatalogRow[];
  fanName: string;
  inbound: string;
  proofAvailable?: boolean;
  deliveryConfirmed?: boolean;
};

export type WriteResult = {
  bubbles: string[];
  dropped: boolean;
  dropReason: string | null;
  model: string;
};

export type ThoughtKind =
  | "ingest"
  | "safety"
  | "triage"
  | "route"
  | "plan"
  | "write"
  | "clock"
  | "diary"
  | "queue"
  | "handoff";

export type ThreadState =
  | "open"
  | "parked"
  | "held"
  | "awaiting_pay"
  | "fulfilling"
  | "aftercare"
  | "handoff"
  | "killed";

export type OperatorThread = {
  id: string;
  fanId: string;
  fanName: string;
  handle: string | null;
  source: string;
  archetype: string;
  workflow: WorkflowId;
  state: ThreadState;
  takeover: boolean;
  unread: number;
  lastPreview: string;
  lastAt: string | null;
  lifetimeCents: number;
  trust: number;
  agentName: string | null;
};

export type OperatorMessage = {
  id: string;
  role: "fan" | "persona" | "system" | "draft";
  body: string;
  workflow: string | null;
  status: string;
  auto: boolean;
  createdAt: string;
  agentName: string | null;
};

export type OperatorThought = {
  id: string;
  kind: ThoughtKind | string;
  body: string;
  createdAt: string;
};

export type OperatorDiary = {
  id: string;
  voice: DiaryVoice;
  body: string;
  createdAt: string;
};

export type OperatorPlan = ReplyPlan & { id: string; createdAt: string };

export type ModelCallRow = {
  id: string;
  task: string;
  model: string;
  latencyMs: number;
  outcome: string;
  fallback: boolean;
  createdAt: string;
};

export type SeatRow = {
  kind: string;
  capacity: number;
  held: number;
};

export type OfferRow = {
  id: string;
  sku: string;
  priceCents: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
};

export type TicketRow = {
  id: string;
  kind: string;
  body: string;
  status: string;
  createdAt: string;
};

export type ActivityKind =
  | "inbound"
  | "typing"
  | "sent"
  | "held"
  | "handoff"
  | "killed"
  | "failed";

export type DeskRosterEntry = {
  name: string;
  tone: string;
  live: boolean;
  threadCount: number;
};

export type DeskActivity = {
  id: string;
  agentName: string;
  kind: ActivityKind | string;
  body: string;
  threadId: string | null;
  createdAt: string;
};

export type DeskSnapshot = {
  persona: {
    id: string;
    handle: string;
    displayName: string;
    timezone: string;
    autoSend: boolean;
    hour: number;
    clockLabel: string;
    quiet: boolean;
    backgroundRun: boolean;
    agentName: string;
    emergencyStop?: boolean;
    automationMode?: string;
  };
  seats: SeatRow[];
  catalog: CatalogRow[];
  threads: OperatorThread[];
  tickets: TicketRow[];
  calls: ModelCallRow[];
  eval: { passed: number; total: number; autoSendAllowed: boolean };
  roster: DeskRosterEntry[];
  activity: DeskActivity[];
};

export type ThreadSnapshot = {
  thread: OperatorThread;
  messages: OperatorMessage[];
  thoughts: OperatorThought[];
  diary: OperatorDiary[];
  plan: OperatorPlan | null;
  offers: OfferRow[];
  claims: ClockSlot[];
};
