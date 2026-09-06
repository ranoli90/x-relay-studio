/** Canonical mapping for Telegram observations → agent_messages. Pure; no SQL. */

export const HUMAN_MANUAL_ORIGIN = "human_manual";
export const CONFIRMED_AI_ORIGIN = "confirmed_ai_outbox";

export type ObservedSelfMessage = {
  userId: string;
  threadId?: string | null;
  fromSelf: boolean;
  body: string;
  telegramMessageId?: number | string | null;
  createdAt?: string | Date | null;
  watermark?: string | Date | null;
};

export type AgentTransportRow = {
  userId: string;
  threadId?: string | null;
  transportMessageId?: string | null;
  origin?: string | null;
  role?: string | null;
};

export type MirroredAgentRow = {
  id: string;
  userId: string;
  threadId: string;
  role: "persona";
  body: string;
  status: "sent";
  origin: typeof HUMAN_MANUAL_ORIGIN;
  transportMessageId: string;
  actionable: false;
};

export type MirrorSkipReason =
  | "not_from_self"
  | "no_transport_id"
  | "agent_echo"
  | "already_mirrored";

export type MirrorDecision =
  | { action: "skip"; reason: MirrorSkipReason }
  | {
      action: "upsert";
      role: "persona";
      status: "sent";
      origin: typeof HUMAN_MANUAL_ORIGIN;
      transportMessageId: string;
      actionable: false;
      historical: boolean;
    };

export function normalizeTransportId(raw: number | string | null | undefined): string | null {
  if (raw == null) return null;
  const id = String(raw).trim();
  if (!id || id === "0") return null;
  return id;
}

function isHistoricalImport(createdAt?: string | Date | null, watermark?: string | Date | null): boolean {
  if (!watermark) return true;
  const created = createdAt ? new Date(createdAt).getTime() : NaN;
  const mark = new Date(watermark).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(mark)) return true;
  return created <= mark;
}

function sameTransport(
  row: AgentTransportRow,
  userId: string,
  threadId: string | null | undefined,
  transportId: string,
): boolean {
  if (row.userId !== userId) return false;
  if (normalizeTransportId(row.transportMessageId) !== transportId) return false;
  if (threadId && row.threadId && row.threadId !== threadId) return false;
  return true;
}

/**
 * A from_self Telegram observation becomes one persona/sent/human_manual row
 * unless the transport id already exists on agent_messages (agent echo or
 * prior mirror). Never queued, never auto-replied.
 */
export function decideManualOutboundMirror(input: {
  fromSelf: boolean;
  telegramMessageId?: number | string | null;
  existing: Iterable<AgentTransportRow>;
  userId: string;
  threadId?: string | null;
  createdAt?: string | Date | null;
  watermark?: string | Date | null;
}): MirrorDecision {
  if (!input.fromSelf) return { action: "skip", reason: "not_from_self" };
  const transportId = normalizeTransportId(input.telegramMessageId);
  if (!transportId) return { action: "skip", reason: "no_transport_id" };

  for (const row of input.existing) {
    if (!sameTransport(row, input.userId, input.threadId, transportId)) continue;
    const origin = (row.origin ?? "").toLowerCase();
    if (origin === HUMAN_MANUAL_ORIGIN || origin === "confirmed_human_outbox") {
      return { action: "skip", reason: "already_mirrored" };
    }
    return { action: "skip", reason: "agent_echo" };
  }

  return {
    action: "upsert",
    role: "persona",
    status: "sent",
    origin: HUMAN_MANUAL_ORIGIN,
    transportMessageId: transportId,
    actionable: false,
    historical: isHistoricalImport(input.createdAt, input.watermark),
  };
}

export function applyManualOutboundMirror(
  store: MirroredAgentRow[],
  input: ObservedSelfMessage & { threadId: string; id?: string },
  existing: Iterable<AgentTransportRow> = store,
): { row: MirroredAgentRow | null; decision: MirrorDecision } {
  const decision = decideManualOutboundMirror({
    fromSelf: input.fromSelf,
    telegramMessageId: input.telegramMessageId,
    existing,
    userId: input.userId,
    threadId: input.threadId,
    createdAt: input.createdAt,
    watermark: input.watermark,
  });
  if (decision.action !== "upsert") return { row: null, decision };
  const row: MirroredAgentRow = {
    id: input.id ?? `msg_${store.length + 1}`,
    userId: input.userId,
    threadId: input.threadId,
    role: "persona",
    body: input.body,
    status: "sent",
    origin: HUMAN_MANUAL_ORIGIN,
    transportMessageId: decision.transportMessageId,
    actionable: false,
  };
  store.push(row);
  return { row, decision };
}

export type MemoryAgentStore = {
  rows: MirroredAgentRow[];
  observe(
    input: ObservedSelfMessage & { threadId: string; id?: string },
  ): { row: MirroredAgentRow | null; decision: MirrorDecision };
};

/** In-memory mapping for tests. No live Telegram. */
export function createMemoryAgentStore(seed: MirroredAgentRow[] = []): MemoryAgentStore {
  const rows = seed.slice();
  return {
    rows,
    observe(input) {
      return applyManualOutboundMirror(rows, input);
    },
  };
}

export type PreSendFenceInput = {
  emergencyStop?: boolean;
  takeover?: boolean;
  optOut?: boolean;
};

export type PreSendFenceResult =
  | { allow: true }
  | { allow: false; reason: "emergency_stop" | "takeover" | "opt_out" };

/**
 * Fail closed on provided stop flags. Missing flags are not a stop.
 * Callers must pass the flags through; do not re-query SQL here.
 */
export function preSendFence(flags: PreSendFenceInput): PreSendFenceResult {
  if (flags.emergencyStop) return { allow: false, reason: "emergency_stop" };
  if (flags.takeover) return { allow: false, reason: "takeover" };
  if (flags.optOut) return { allow: false, reason: "opt_out" };
  return { allow: true };
}

export type IngressCreditEvent = {
  safetyKilled: boolean;
  parked: boolean;
  takeoverNoModel: boolean;
  alreadyBilled: boolean;
  aftercare: boolean;
  failedModel: boolean;
  humanOnly: boolean;
  availableCredits: number;
};

/**
 * Only a confirmed auto-send path may burn. Held / local / not_live / killed
 * skip. Zero credits still allow processInbound(forceHold) — that is not this
 * helper's job.
 */
export function decideIngressCreditBurn(
  result: { auto: boolean; killed?: boolean },
  credits: number,
): { shouldBurn: boolean; event: IngressCreditEvent } {
  const auto = result.auto === true;
  return {
    shouldBurn: auto,
    event: {
      safetyKilled: Boolean(result.killed),
      parked: false,
      takeoverNoModel: false,
      alreadyBilled: false,
      aftercare: false,
      failedModel: false,
      humanOnly: !auto,
      availableCredits: credits,
    },
  };
}

/** Bounded dialog history per poll. Flood/cooldowns stay in the caller. */
export const FAIR_HISTORY_CHATS = 4;

export function fairHistoryChats(skipDialogs: boolean): number {
  return skipDialogs ? 0 : FAIR_HISTORY_CHATS;
}
