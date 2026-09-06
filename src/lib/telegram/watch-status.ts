/** Present TelegramWatch cooldown / signed-out state without talking to MTProto. */

export function floodSecondsLeft(floodUntil: string | null | undefined, now = Date.now()): number {
  if (!floodUntil) return 0;
  const until = new Date(floodUntil).getTime();
  if (!Number.isFinite(until)) return 0;
  const left = Math.ceil((until - now) / 1000);
  return left > 0 ? left : 0;
}

export function floodWaitLabel(floodUntil: string | null | undefined, now = Date.now()): string | null {
  const left = floodSecondsLeft(floodUntil, now);
  if (left <= 0) return null;
  if (left < 60) return `${left}s`;
  if (left < 3600) return `${Math.ceil(left / 60)} min`;
  return `${Math.ceil(left / 3600)} hr`;
}

export type WatchTerminal = "revoked" | "flood" | "dead" | null;

export function watchTerminal(
  watch: {
    authDead?: boolean;
    floodUntil?: string | null;
    lastError?: string | null;
  } | null | undefined,
  now = Date.now(),
): WatchTerminal {
  if (watch?.authDead) {
    if (/revok/i.test(watch.lastError ?? "")) return "revoked";
    return "dead";
  }
  if (floodSecondsLeft(watch?.floodUntil, now) > 0) return "flood";
  return null;
}

export function watchTerminalLabel(terminal: WatchTerminal): string | null {
  if (terminal === "revoked") return "Telegram revoked this session. Connect again.";
  if (terminal === "dead") return "Telegram signed this desk out. Connect again.";
  if (terminal === "flood") return "Telegram asked this desk to wait.";
  return null;
}

export function watchIsLocked(
  watch: {
    authDead?: boolean;
    floodUntil?: string | null;
  } | null | undefined,
  now = Date.now(),
): boolean {
  return Boolean(watch?.authDead) || floodSecondsLeft(watch?.floodUntil, now) > 0;
}

export type InboundAiStatus = "outbound" | "imported" | "queued";

/**
 * Bootstrap history is imported-only. Actionable queue requires a watermark
 * and a message strictly after it. Clock-skew ties stay imported.
 */
export function classifyInboundAiStatus(opts: {
  fromSelf: boolean;
  createdAt?: string | Date | null;
  watermark?: string | Date | null;
}): InboundAiStatus {
  if (opts.fromSelf) return "outbound";
  if (!opts.watermark) return "imported";
  const created = opts.createdAt ? new Date(opts.createdAt).getTime() : NaN;
  const mark = new Date(opts.watermark).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(mark)) return "imported";
  if (created <= mark) return "imported";
  return "queued";
}

export function retryBackoffMs(attemptCount: number): number {
  const n = Math.max(1, Math.min(8, Math.floor(attemptCount) || 1));
  return Math.min(15 * 60_000, 15_000 * 2 ** (n - 1));
}
