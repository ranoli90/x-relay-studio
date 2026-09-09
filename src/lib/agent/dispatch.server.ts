import { classifyTransportResult } from "../conversation/outbox.ts";
import { preSendFence } from "../conversation/mirror.ts";
import type { FinalState } from "../operator/state.ts";

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
  replyPartId?: string;
};

export type AutoDispatchResult =
  | { status: "ok"; telegramMessageId?: string }
  | { status: "not_live" }
  | { status: "uncertain"; error: string; telegramMessageId?: string }
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
  if (outcome.kind === "uncertain") {
    return { status: "uncertain", error: outcome.reason, telegramMessageId: outcome.transportMessageId };
  }
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
      return { status: "uncertain", error: outcome.reason, telegramMessageId: outcome.transportMessageId };
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
  const fence = preSendFence(opts);
  if (!fence.allow) return { status: "fail", error: fence.reason };
  const {
    loadLiveFinalState,
    recordDispatchAttempt,
    finishDispatchAttempt,
    findOpenDispatchAttempt,
  } = await import("@/lib/operator/persist.server");
  const { revalidateForSend, canRetryAttempt, reconcileUncertain } = await import("@/lib/operator/state");
  const captured = opts.captured ?? (await loadLiveFinalState(opts.userId, opts.threadId));
  const conversationId = opts.chat ?? opts.peer;
  if (opts.replyPartId) {
    const existing = await findOpenDispatchAttempt(opts.userId, conversationId, opts.replyPartId);
    if (existing) {
      const attempt = {
        id: existing.id,
        conversationId,
        body: opts.body,
        status: existing.status as "uncertain" | "confirmed" | "failed" | "sending" | "queued" | "canceled",
        captured,
        transportMessageId: existing.transport_message_id,
        uncertainReason: null,
        reconciledAs: (existing.reconciled_as as "confirmed" | "failed" | "canceled" | null) ?? null,
        replyPartId: opts.replyPartId,
      };
      if (attempt.status === "confirmed" || attempt.reconciledAs === "confirmed") {
        return { status: "ok", telegramMessageId: attempt.transportMessageId ?? undefined };
      }
      const retry = canRetryAttempt(attempt);
      if (!retry.allow && retry.reason === "uncertain_unreconciled") {
        const found = attempt.transportMessageId
          ? { transportMessageId: attempt.transportMessageId }
          : null;
        const next = reconcileUncertain(attempt, found);
        if (next.status === "confirmed") {
          await finishDispatchAttempt(
            opts.userId,
            attempt.id,
            "confirmed",
            null,
            next.transportMessageId,
          );
          return { status: "ok", telegramMessageId: next.transportMessageId ?? undefined };
        }
        return {
          status: "uncertain",
          error: next.uncertainReason ?? "uncertain_unreconciled",
          telegramMessageId: next.transportMessageId ?? undefined,
        };
      }
      if (!retry.allow && retry.reason === "already_confirmed") {
        return { status: "ok", telegramMessageId: attempt.transportMessageId ?? undefined };
      }
      if (!retry.allow) return { status: "fail", error: retry.reason };
    }
  }
  let send: PeerSend | null;
  try {
    send = await loadPeerSend();
  } catch (err) {
    return classifyThrown(err);
  }
  if (!send) return { status: "not_live" };
  const live = await loadLiveFinalState(opts.userId, opts.threadId);
  const check = revalidateForSend(captured, live);
  if (!check.allow) return { status: "fail", error: check.reason };
  const recorded = await recordDispatchAttempt({
    userId: opts.userId,
    conversationId,
    body: opts.body,
    captured,
    live,
    status: "sending",
    replyPartId: opts.replyPartId ?? null,
  });
  if (!recorded.inserted) {
    const existing = opts.replyPartId
      ? await findOpenDispatchAttempt(opts.userId, conversationId, opts.replyPartId)
      : null;
    if (existing?.status === "confirmed") {
      return { status: "ok", telegramMessageId: existing.transport_message_id ?? undefined };
    }
    return {
      status: "uncertain",
      error: existing?.status === "sending" ? "in_flight" : existing?.status ?? "duplicate_part",
      telegramMessageId: existing?.transport_message_id ?? undefined,
    };
  }
  const attemptId = recorded.id;
  let classified: AutoDispatchResult;
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
      takeover: captured.takeover,
      optOut: captured.optOut,
      emergencyStop: captured.emergencyStop,
      captured,
    });
    classified = classifyReturned(result);
  } catch (err) {
    classified = classifyThrown(err);
  }
  const finishStatus =
    classified.status === "ok" ? "confirmed" : classified.status === "uncertain" ? "uncertain" : "failed";
  const finishReason =
    classified.status === "ok"
      ? null
      : classified.status === "not_live"
        ? "not_live"
        : classified.status === "uncertain" || classified.status === "fail"
          ? classified.error
          : "failed";
  const finishId =
    classified.status === "ok"
      ? classified.telegramMessageId
      : classified.status === "uncertain"
        ? classified.telegramMessageId
        : null;
  try {
    await finishDispatchAttempt(opts.userId, attemptId, finishStatus, finishReason, finishId);
  } catch {
    if (classified.status === "ok" || classified.status === "uncertain") {
      return {
        status: "uncertain",
        error: "possible_transmission:persist_failed",
        telegramMessageId: finishId ?? undefined,
      };
    }
  }
  return classified;
}
