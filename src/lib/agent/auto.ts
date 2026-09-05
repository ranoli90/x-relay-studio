import { autonomyFor } from "./route.ts";
import type { SafetyVerdict, WorkflowId } from "./types.ts";

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
};

export function decideAutoSend(input: DecideAutoSendInput): boolean {
  if (!input.personaAutoSend || !input.goldAllowed) return false;
  if (input.quiet || input.takeover) return false;
  if (input.dropped || input.killed) return false;
  if (input.bubbleCount <= 0) return false;
  if (input.safetyVerdict === "kill" || input.safetyVerdict === "handoff") return false;
  if (input.safetyVerdict === "refuse") return false;
  return autonomyFor(input.workflow, true) === "auto";
}
