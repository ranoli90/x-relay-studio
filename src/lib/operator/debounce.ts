/** Bounded inbound burst. Do not raise poll rate to catch up. */

export const BURST_QUIET_MS = 1_500;
export const BURST_MAX_MS = 8_000;

export type BurstInput = {
  firstInboundAt: number;
  lastInboundAt: number;
  now: number;
  pendingAfter: number;
};

export type BurstDecision = "wait" | "flush";

/**
 * A short burst becomes one coherent reply after a quiet window, or at the
 * hard cap so a talkative partner cannot starve the desk.
 */
export function burstDecision(input: BurstInput): BurstDecision {
  if (input.pendingAfter <= 0) return "flush";
  if (input.now - input.firstInboundAt >= BURST_MAX_MS) return "flush";
  if (input.now - input.lastInboundAt >= BURST_QUIET_MS) return "flush";
  return "wait";
}

export function nextBurstRetryAt(now: number, quietMs = BURST_QUIET_MS): Date {
  return new Date(now + Math.max(250, quietMs));
}
