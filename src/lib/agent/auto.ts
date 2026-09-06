import { autonomyFor } from "./route.ts";
import type { SafetyVerdict, WorkflowId } from "./types.ts";
import {
  decideLiveAutoSend,
  type AdultEligibility,
  type AutomationMode,
  type GenerationOrigin,
} from "../conversation/policy.ts";

export type DecideAutoSendInput = {
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

/** Autopilot is operator-controlled. Reads never rearm it. */
export const AUTOPILOT_ALWAYS_ON = false;

export function decideAutoSend(input: DecideAutoSendInput): boolean {
  if (input.takeover) return false;
  if (input.dropped || input.killed) return false;
  if (input.bubbleCount <= 0) return false;
  if (input.safetyVerdict === "kill" || input.safetyVerdict === "handoff") return false;
  if (input.safetyVerdict === "refuse") return false;
  if (autonomyFor(input.workflow, true) !== "auto") return false;
  return decideLiveAutoSend(input).send;
}
