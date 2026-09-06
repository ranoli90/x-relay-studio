import type { SafetyVerdict, WorkflowId } from "../agent/types.ts";
import { autonomyFor } from "../agent/route.ts";

export const AUTOMATION_MODES = ["off", "import_only", "draft", "approved_auto"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const GENERATION_ORIGINS = [
  "validated_model",
  "local_template",
  "explicit_human_send",
  "approved_service_notice",
  "none",
] as const;
export type GenerationOrigin = (typeof GENERATION_ORIGINS)[number];

export const ADULT_STATES = ["allowed", "unknown", "disallowed"] as const;
export type AdultEligibility = (typeof ADULT_STATES)[number];

const ADULT_RESTRICTED: ReadonlySet<WorkflowId> = new Set([
  "W4_QUALIFY",
  "W6_CLOSE_NOW",
  "W7_GFE",
  "W8_OFFER",
  "W13_PROOF",
]);

export type AutoSendDecisionInput = {
  personaAutoSend: boolean;
  goldAllowed: boolean;
  quiet: boolean;
  takeover: boolean;
  workflow: WorkflowId;
  dropped: boolean;
  killed: boolean;
  bubbleCount: number;
  safetyVerdict: SafetyVerdict;
  emergencyStop?: boolean;
  partnerOptOut?: boolean;
  automationMode?: AutomationMode;
  generationOrigin?: GenerationOrigin;
  adultEligibility?: AdultEligibility;
  accountLive?: boolean;
  conversationPermitted?: boolean;
};

export type AutoSendDecision = {
  send: boolean;
  reason: string;
};

/**
 * Live auto-send requires an explicit approved-auto mode, a validated model
 * result, and no hard stop. Reads never set these flags.
 */
export function decideLiveAutoSend(input: AutoSendDecisionInput): AutoSendDecision {
  if (input.emergencyStop) return { send: false, reason: "emergency_stop" };
  if (input.partnerOptOut) return { send: false, reason: "partner_opt_out" };
  if (input.takeover) return { send: false, reason: "takeover" };
  if (input.killed) return { send: false, reason: "killed" };
  if (input.dropped) return { send: false, reason: "dropped" };
  if (input.bubbleCount <= 0) return { send: false, reason: "empty" };
  if (input.safetyVerdict === "kill" || input.safetyVerdict === "handoff") {
    return { send: false, reason: `safety_${input.safetyVerdict}` };
  }
  if (input.safetyVerdict === "refuse") return { send: false, reason: "safety_refuse" };
  if (input.adultEligibility === "disallowed") return { send: false, reason: "adult_disallowed" };
  if (input.adultEligibility === "unknown" && ADULT_RESTRICTED.has(input.workflow)) {
    return { send: false, reason: "adult_unknown" };
  }
  if (input.conversationPermitted === false) return { send: false, reason: "not_permitted" };
  if (input.accountLive === false) return { send: false, reason: "not_live" };
  if (!input.personaAutoSend) return { send: false, reason: "operator_off" };

  const mode = input.automationMode ?? "draft";
  if (mode === "off" || mode === "import_only") return { send: false, reason: `mode_${mode}` };
  if (mode === "draft") return { send: false, reason: "mode_draft" };
  if (mode !== "approved_auto") return { send: false, reason: "mode_unknown" };

  const origin = input.generationOrigin ?? "none";
  if (origin !== "validated_model" && origin !== "approved_service_notice") {
    return { send: false, reason: `origin_${origin}` };
  }

  if (autonomyFor(input.workflow, true) !== "auto") {
    return { send: false, reason: "workflow_draft" };
  }

  return { send: true, reason: "approved_auto" };
}

export function parseAutomationMode(raw: unknown): AutomationMode {
  if (raw === "off" || raw === "import_only" || raw === "draft" || raw === "approved_auto") return raw;
  return "draft";
}
