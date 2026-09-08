/** Desired auto-reply vs effective operation. Reads never rearm a stop. */

export const EFFECTIVE_STATES = [
  "setup_required",
  "active",
  "degraded",
  "paused_by_operator",
  "conversation_taken_over",
  "blocked_by_permission",
  "blocked_by_policy",
  "waiting_for_payment_verification",
  "transport_uncertain",
  "stopped",
  "disconnected",
] as const;

export type EffectiveState = (typeof EFFECTIVE_STATES)[number];

export type AutoReplyView = {
  desired: boolean;
  effective: EffectiveState;
  reason: string;
  scope: "desk" | "conversation";
  lastSuccessAt: string | null;
  recovery: string;
};

export type ReadinessInput = {
  desiredAutoReply: boolean;
  emergencyStop: boolean;
  processingPermission: boolean;
  connected: boolean;
  publishedOffers: number;
  writerReady: boolean;
  takeover: boolean;
  optOut: boolean;
  uncertainSend: boolean;
  awaitingPaymentVerification: boolean;
  lastSuccessAt: string | null;
};

export function effectiveAutoReply(input: ReadinessInput): AutoReplyView {
  const desired = input.desiredAutoReply;
  if (input.emergencyStop) {
    return view(desired, "stopped", "Emergency stop is on.", "desk", input.lastSuccessAt, "Turn Stop off, then confirm readiness.");
  }
  if (!input.connected) {
    return view(desired, "disconnected", "No live Telegram account is connected.", "desk", input.lastSuccessAt, "Connect an authorized account.");
  }
  if (input.optOut) {
    return view(desired, "blocked_by_policy", "This customer opted out of contact.", "conversation", input.lastSuccessAt, "Do not message unless they opt in.");
  }
  if (input.takeover) {
    return view(
      desired,
      "conversation_taken_over",
      "A human owns this conversation.",
      "conversation",
      input.lastSuccessAt,
      "Release takeover when the human is done.",
    );
  }
  if (!input.processingPermission) {
    return view(
      desired,
      "blocked_by_permission",
      "Processing permission is off.",
      "desk",
      input.lastSuccessAt,
      "Authorize processing after the disclosure and readiness checks.",
    );
  }
  if (input.publishedOffers <= 0) {
    return view(
      desired,
      "setup_required",
      "No published business offers yet.",
      "desk",
      input.lastSuccessAt,
      "Review and publish at least one offer on Business.",
    );
  }
  if (input.uncertainSend) {
    return view(
      desired,
      "transport_uncertain",
      "A previous send is not confirmed.",
      "conversation",
      input.lastSuccessAt,
      "Reconcile the uncertain send before retrying.",
    );
  }
  if (input.awaitingPaymentVerification) {
    return view(
      desired,
      "waiting_for_payment_verification",
      "Payment evidence is pending verification.",
      "conversation",
      input.lastSuccessAt,
      "Wait for the provider event. Do not mark paid from a screenshot.",
    );
  }
  if (!desired) {
    return view(desired, "paused_by_operator", "Automatic replies are paused.", "desk", input.lastSuccessAt, "Enable automatic replies when ready.");
  }
  if (!input.writerReady) {
    return view(
      desired,
      "degraded",
      "The writer route is not proven capable.",
      "desk",
      input.lastSuccessAt,
      "A successful generation probe is required; credentials alone are not enough.",
    );
  }
  return view(desired, "active", "Authorized automatic replies are running.", "desk", input.lastSuccessAt, "");
}

function view(
  desired: boolean,
  effective: EffectiveState,
  reason: string,
  scope: "desk" | "conversation",
  lastSuccessAt: string | null,
  recovery: string,
): AutoReplyView {
  return { desired, effective, reason, scope, lastSuccessAt, recovery };
}

export function publicEffectiveLabel(view: AutoReplyView): string {
  switch (view.effective) {
    case "active":
      return view.desired ? "Automatic replies enabled · Running" : "Paused by operator";
    case "setup_required":
      return "Enabled · Waiting for business setup";
    case "degraded":
      return "Enabled · Writer not ready";
    case "paused_by_operator":
      return "Paused by operator";
    case "conversation_taken_over":
      return "Human handling this conversation";
    case "blocked_by_permission":
      return "Blocked · Processing permission off";
    case "blocked_by_policy":
      return "Blocked · Customer opted out";
    case "waiting_for_payment_verification":
      return "Waiting for payment verification";
    case "transport_uncertain":
      return "Not confirmed · Reconcile before retry";
    case "stopped":
      return "Stopped";
    case "disconnected":
      return "Disconnected";
  }
}
