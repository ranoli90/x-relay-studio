import { classifyTransportResult } from "@/lib/conversation/outbox.ts";

export type AutoDispatchInput = {
  userId: string;
  peer: string;
  chat?: string;
  body: string;
  agentName: string;
  threadId?: string;
  accountGeneration?: number;
  consentEpoch?: number;
  takeover?: boolean;
  optOut?: boolean;
  emergencyStop?: boolean;
};

export type AutoDispatchResult =
  | { status: "ok"; telegramMessageId?: string }
  | { status: "not_live" }
  | { status: "uncertain"; error: string }
  | { status: "fail"; error: string };

type PeerSend = (opts: Record<string, unknown>) => Promise<unknown>;

function classifyThrown(err: unknown): AutoDispatchResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Failed to resolve|Cannot resolve|Failed to fetch dynamically imported/i.test(
      msg,
    )
  ) {
    return { status: "not_live" };
  }
  const outcome = classifyTransportResult(undefined, err);
  if (outcome.kind === "not_live") return { status: "not_live" };
  if (outcome.kind === "uncertain") return { status: "uncertain", error: outcome.reason };
  return { status: "fail", error: outcome.kind === "failed_definitive" ? outcome.reason : msg.slice(0, 240) };
}

function classifyReturned(value: unknown): AutoDispatchResult {
  const outcome = classifyTransportResult(value);
  switch (outcome.kind) {
    case "sent_confirmed":
      return { status: "ok", telegramMessageId: outcome.transportMessageId };
    case "not_live":
      return { status: "not_live" };
    case "uncertain":
    case "local":
    case "blocked":
      return { status: "uncertain", error: outcome.reason };
    case "failed_definitive":
    case "canceled_stale":
      return { status: "fail", error: outcome.reason };
  }
}

async function loadPeerSend(): Promise<PeerSend | null> {
  try {
    const mod = (await import("../telegram/agent-send.server.ts")) as unknown as {
      agentSendToPeer?: PeerSend;
    };
    if (typeof mod.agentSendToPeer === "function") return mod.agentSendToPeer;
  } catch (err) {
    const classified = classifyThrown(err);
    if (classified.status === "not_live") return null;
    throw err;
  }
  return null;
}

export async function tryDispatchAutoSend(opts: AutoDispatchInput): Promise<AutoDispatchResult> {
  if (opts.emergencyStop) return { status: "fail", error: "emergency_stop" };
  if (opts.takeover) return { status: "fail", error: "takeover" };
  if (opts.optOut) return { status: "fail", error: "opt_out" };
  let send: PeerSend | null;
  try {
    send = await loadPeerSend();
  } catch (err) {
    return classifyThrown(err);
  }
  if (!send) return { status: "not_live" };
  try {
    const result = await send({
      userId: opts.userId,
      peerId: opts.peer,
      chatId: opts.chat ?? opts.peer,
      body: opts.body,
      agentName: opts.agentName,
      threadId: opts.threadId,
      accountGeneration: opts.accountGeneration,
      consentEpoch: opts.consentEpoch,
    });
    return classifyReturned(result);
  } catch (err) {
    return classifyThrown(err);
  }
}
