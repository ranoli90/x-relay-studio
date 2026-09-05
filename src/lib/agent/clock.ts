import type { ClockSlot } from "./types.ts";

export function hourInZone(now: Date, timeZone: string): number {
  return clockParts(now, timeZone).hour;
}

export function clockParts(now: Date, timeZone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    return {
      hour: Number.isFinite(hour) ? hour : now.getHours(),
      minute: Number.isFinite(minute) ? minute : now.getMinutes(),
    };
  } catch {
    return { hour: now.getHours(), minute: now.getMinutes() };
  }
}

export function activeClaim(hour: number, claims: ClockSlot[]): ClockSlot | null {
  for (const c of claims) {
    if (c.startHour == null || c.endHour == null) continue;
    if (inWindow(hour, c.startHour, c.endHour)) return c;
  }
  return null;
}

export function inWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function clockLabel(hour: number, claims: ClockSlot[], minute = 0): string {
  const c = activeClaim(hour, claims);
  const stamp = `${pad(hour)}:${pad(minute)}`;
  if (c) return `${stamp} · ${c.claim}`;
  return `${stamp} · unscheduled`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Draft contradicts ME claims + clock (gym+bed at 15:02, etc.). */
export function clockContradiction(draft: string, hour: number, claims: ClockSlot[]): string | null {
  const active = activeClaim(hour, claims);
  const lower = draft.toLowerCase();
  const mentions: { key: string; re: RegExp }[] = [
    { key: "gym", re: /\b(gym|workout|just (got )?back from (the )?gym)\b/ },
    { key: "sleep", re: /\b(in bed|just woke|asleep|napping|going to sleep)\b/ },
    { key: "warehouse", re: /\b(at work|warehouse|on shift|clock(ed)? in)\b/ },
    { key: "available", re: /\b(just got off|free all night|laying around)\b/ },
  ];
  const hit = mentions.find((m) => m.re.test(lower));
  if (!hit) return null;
  if (!active) return null;
  const kind = active.kind.toLowerCase();
  if (hit.key === kind) return null;
  if (kind.includes(hit.key)) return null;
  return `life clock: claimed '${hit.key}' while persona is '${active.claim}'`;
}
