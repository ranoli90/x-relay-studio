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

export function watchIsLocked(
  watch: {
    authDead?: boolean;
    floodUntil?: string | null;
  } | null | undefined,
  now = Date.now(),
): boolean {
  return Boolean(watch?.authDead) || floodSecondsLeft(watch?.floodUntil, now) > 0;
}
