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

/** Never schedule a retry past the hard cap for this burst. */
export function nextBurstRetryAt(
  now: number,
  opts?: { firstInboundAt?: number; quietMs?: number; maxMs?: number },
): Date {
  const quietMs = opts?.quietMs ?? BURST_QUIET_MS;
  const maxMs = opts?.maxMs ?? BURST_MAX_MS;
  const wait = Math.max(250, quietMs);
  let at = now + wait;
  if (opts?.firstInboundAt != null) {
    at = Math.min(at, opts.firstInboundAt + maxMs);
  }
  return new Date(Math.max(now + 50, at));
}

/** Combine ordered burst bodies into one generation unit. */
export function coalesceInboundBodies(bodies: readonly string[]): string {
  const lines: string[] = [];
  for (const raw of bodies) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (lines[lines.length - 1] === text) continue;
    lines.push(text);
  }
  return lines.join("\n");
}
