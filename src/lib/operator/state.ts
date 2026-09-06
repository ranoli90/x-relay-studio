import type { AutomationMode } from "../conversation/policy.ts";

export const SEND_STATUSES = [
  "draft",
  "approved_not_sent",
  "queued",
  "sending",
  "confirmed",
  "failed",
  "uncertain",
  "canceled",
] as const;

export type SendStatus = (typeof SEND_STATUSES)[number];

export type FinalState = {
  accountGeneration: number;
  consentEpoch: number;
  permissionRevision: number;
  businessRevision: number | null;
  emergencyStop: boolean;
  takeover: boolean;
  optOut: boolean;
  automationMode: AutomationMode;
  processingPermission: boolean;
  conversationPermitted: boolean;
  accountLive: boolean;
  assetApprovalOk: boolean;
};

export type RevalidateResult =
  | { allow: true; live: FinalState }
  | { allow: false; reason: string };

/**
 * Authoritative transport-boundary check. `captured` is the snapshot taken
 * when work started. `live` must be a freshly loaded object — passing the
 * same reference is not revalidation (TG-12).
 */
export function revalidateForSend(captured: FinalState, live: FinalState): RevalidateResult {
  if (captured === live) {
    return { allow: false, reason: "stale_object_not_revalidated" };
  }
  if (live.emergencyStop) return { allow: false, reason: "emergency_stop" };
  if (live.takeover) return { allow: false, reason: "takeover" };
  if (live.optOut) return { allow: false, reason: "opt_out" };
  if (!live.processingPermission) return { allow: false, reason: "permission_revoked" };
  if (!live.conversationPermitted) return { allow: false, reason: "not_permitted" };
  if (!live.accountLive) return { allow: false, reason: "not_live" };
  if (!live.assetApprovalOk) return { allow: false, reason: "asset_not_approved" };
  if (live.accountGeneration !== captured.accountGeneration) {
    return { allow: false, reason: "stale_account_generation" };
  }
  if (live.consentEpoch !== captured.consentEpoch) {
    return { allow: false, reason: "stale_consent" };
  }
  if (live.permissionRevision !== captured.permissionRevision) {
    return { allow: false, reason: "stale_permission" };
  }
  if (live.businessRevision !== captured.businessRevision) {
    return { allow: false, reason: "stale_business_revision" };
  }
  if (live.automationMode !== "approved_auto") {
    return { allow: false, reason: `mode_${live.automationMode}` };
  }
  return { allow: true, live };
}

export function cloneFinalState(state: FinalState): FinalState {
  return { ...state };
}

export function bumpPermission(state: FinalState): FinalState {
  return { ...state, permissionRevision: state.permissionRevision + 1, processingPermission: false };
}

export type SendAttempt = {
  id: string;
  conversationId: string;
  body: string;
  status: SendStatus;
  captured: FinalState;
  transportMessageId: string | null;
  uncertainReason: string | null;
  reconciledAs: "confirmed" | "failed" | "canceled" | null;
};

export type RetryDecision =
  | { allow: true }
  | { allow: false; reason: "in_flight" | "already_confirmed" | "uncertain_unreconciled" | "canceled" };

/** Uncertain results must be reconciled before a new send of the same attempt. */
export function canRetryAttempt(attempt: SendAttempt): RetryDecision {
  if (attempt.status === "sending" || attempt.status === "queued") {
    return { allow: false, reason: "in_flight" };
  }
  if (attempt.status === "confirmed") return { allow: false, reason: "already_confirmed" };
  if (attempt.status === "canceled") return { allow: false, reason: "canceled" };
  if (attempt.status === "uncertain" && !attempt.reconciledAs) {
    return { allow: false, reason: "uncertain_unreconciled" };
  }
  if (attempt.status === "uncertain" && attempt.reconciledAs === "confirmed") {
    return { allow: false, reason: "already_confirmed" };
  }
  return { allow: true };
}

export function applyTransportOutcome(
  attempt: SendAttempt,
  outcome: {
    kind: "sent_confirmed" | "failed_definitive" | "uncertain" | "blocked" | "canceled_stale" | "not_live";
    transportMessageId?: string;
    reason?: string;
  },
): SendAttempt {
  if (outcome.kind === "sent_confirmed") {
    return {
      ...attempt,
      status: "confirmed",
      transportMessageId: outcome.transportMessageId ?? attempt.transportMessageId,
      uncertainReason: null,
      reconciledAs: "confirmed",
    };
  }
  if (outcome.kind === "canceled_stale" || outcome.kind === "blocked") {
    return {
      ...attempt,
      status: "canceled",
      uncertainReason: outcome.reason ?? outcome.kind,
      reconciledAs: "canceled",
    };
  }
  if (outcome.kind === "failed_definitive" || outcome.kind === "not_live") {
    return {
      ...attempt,
      status: "failed",
      uncertainReason: outcome.reason ?? outcome.kind,
      reconciledAs: "failed",
    };
  }
  return {
    ...attempt,
    status: "uncertain",
    uncertainReason: outcome.reason ?? "uncertain",
    reconciledAs: null,
  };
}

export function reconcileUncertain(
  attempt: SendAttempt,
  found: { transportMessageId: string } | null,
): SendAttempt {
  if (attempt.status !== "uncertain") return attempt;
  if (found?.transportMessageId) {
    return {
      ...attempt,
      status: "confirmed",
      transportMessageId: found.transportMessageId,
      reconciledAs: "confirmed",
    };
  }
  return {
    ...attempt,
    status: "failed",
    reconciledAs: "failed",
  };
}

export function publicSendLabel(status: SendStatus): string {
  switch (status) {
    case "draft":
      return "Draft — not sent";
    case "approved_not_sent":
      return "Approved — not sent";
    case "queued":
      return "Queued";
    case "sending":
      return "Sending";
    case "confirmed":
      return "Sent";
    case "failed":
      return "Failed";
    case "uncertain":
      return "Not confirmed";
    case "canceled":
      return "Canceled";
  }
}
