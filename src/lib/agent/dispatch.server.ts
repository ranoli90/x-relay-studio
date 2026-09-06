import { classifyTransportResult } from "../conversation/outbox.ts";
import { preSendFence } from "../conversation/mirror.ts";
import { revalidateForSend, type FinalState } from "../operator/state.ts";

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
  captured?: FinalState;
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
      return { status: "uncertain", error: outcome.reason };
    case "local":
    case "blocked":
    case "failed_definitive":
    case "canceled_stale":
      return { status: "fail", error: outcome.reason };
  }
}

function capturedFromOpts(opts: AutoDispatchInput): FinalState {
  if (opts.captured) return opts.captured;
  return {
    accountGeneration: opts.accountGeneration ?? 1,
    consentEpoch: opts.consentEpoch ?? 1,
    permissionRevision: 1,
    businessRevision: null,
    emergencyStop: Boolean(opts.emergencyStop),
    takeover: Boolean(opts.takeover),
    optOut: Boolean(opts.optOut),
    automationMode: "approved_auto",
    processingPermission: true,
    conversationPermitted: true,
    accountLive: true,
    assetApprovalOk: true,
  };
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
  const fence = preSendFence(opts);
  if (!fence.allow) return { status: "fail", error: fence.reason };
  let send: PeerSend | null;
  try {
    send = await loadPeerSend();
  } catch (err) {
    return classifyThrown(err);
  }
  if (!send) return { status: "not_live" };

  const captured = capturedFromOpts(opts);
  let live: FinalState;
  try {
    const { loadLiveFinalState } = await import("../operator/persist.server.ts");
    live = await loadLiveFinalState(opts.userId, opts.threadId);
  } catch {
    return { status: "fail", error: "state_unavailable" };
  }
  const check = revalidateForSend(captured, live);
  if (!check.allow) return { status: "fail", error: check.reason };

  try {
    const { recordDispatchAttempt } = await import("../operator/persist.server.ts");
    await recordDispatchAttempt({
      userId: opts.userId,
      conversationId: opts.threadId ?? opts.chat ?? opts.peer,
      body: opts.body,
      captured,
      live,
      status: "sending",
    }).catch(() => undefined);
  } catch {
    /* send_attempts table may be pending */
  }

  try {
    const result = await send({
      userId: opts.userId,
      peerId: opts.peer,
      chatId: opts.chat ?? opts.peer,
      body: opts.body,
      agentName: opts.agentName,
      threadId: opts.threadId,
      accountGeneration: captured.accountGeneration,
      consentEpoch: captured.consentEpoch,
      permissionRevision: captured.permissionRevision,
      businessRevision: captured.businessRevision,
      takeover: captured.takeover,
      optOut: captured.optOut,
      emergencyStop: captured.emergencyStop,
      captured,
    });
    const classified = classifyReturned(result);
    if (classified.status === "ok") {
      const again = await import("../operator/persist.server.ts")
        .then((m) => m.loadLiveFinalState(opts.userId, opts.threadId))
        .catch(() => null);
      if (again) {
        const post = revalidateForSend(captured, again);
        if (!post.allow) {
          try {
            const { finishDispatchAttempt } = await import("../operator/persist.server.ts");
            await finishDispatchAttempt(opts.userId, opts.threadId ?? opts.peer, "uncertain", post.reason);
          } catch {
            /* ignore */
          }
          // Transport may have delivered. Uncertain blocks retry (TG-15) and is not confirmed (TG-14).
          return { status: "uncertain", error: post.reason };
        }
      }
    }
    try {
      const { finishDispatchAttempt } = await import("../operator/persist.server.ts");
      const status =
        classified.status === "ok"
          ? "confirmed"
          : classified.status === "uncertain"
            ? "uncertain"
            : classified.status === "not_live"
              ? "failed"
              : "failed";
      await finishDispatchAttempt(
        opts.userId,
        opts.threadId ?? opts.peer,
        status,
        classified.status === "ok" ? null : "error" in classified ? classified.error : classified.status,
        classified.status === "ok" ? classified.telegramMessageId : undefined,
      );
    } catch {
      /* ignore */
    }
    return classified;
  } catch (err) {
    return classifyThrown(err);
  }
}
