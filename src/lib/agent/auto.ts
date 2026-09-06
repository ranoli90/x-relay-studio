import { autonomyFor } from "./route.ts";
import type { SafetyVerdict, WorkflowId } from "./types.ts";

export type DecideAutoSendInput = {
  /** Ignored. Autopilot is always armed. Kept so callers stay stable. */
  personaAutoSend: boolean;
  /** Ignored. Gold eval no longer gates send. */
  goldAllowed: boolean;
  quiet: boolean;
  takeover: boolean;
  workflow: WorkflowId;
  dropped: boolean;
  killed: boolean;
  bubbleCount: number;
  safetyVerdict: SafetyVerdict;
};

/** Autopilot is always on. Gold eval does not gate send. */
export const AUTOPILOT_ALWAYS_ON = true;

export function decideAutoSend(input: DecideAutoSendInput): boolean {
  if (input.takeover) return false;
  if (input.dropped || input.killed) return false;
  if (input.bubbleCount <= 0) return false;
  if (input.safetyVerdict === "kill" || input.safetyVerdict === "handoff") return false;
  if (input.safetyVerdict === "refuse") return false;
  return autonomyFor(input.workflow, true) === "auto";
}
