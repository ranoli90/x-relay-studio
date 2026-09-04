import { extractHandle } from "@/lib/x/ids";

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** Seeded once per user when the master watch list is empty. Shared by every posting account. */
export const STARTER_WATCH = ["naval", "paulg", "sama", "karpathy", "levelsio"] as const;

/** Pull unique X handles out of a messy paste: lines, commas, @mentions, profile URLs. */
export function parseHandles(raw: string): string[] {
  const tokens = raw.split(/[\s,;|]+/g).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const handle =
      extractHandle(token) ??
      (HANDLE_RE.test(token.replace(/^@/, "")) ? token.replace(/^@/, "") : null);
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(handle);
  }
  return out;
}

export function guessHandle(displayName: string | null, email: string | null): string {
  const name = (displayName ?? "").trim();
  if (name) {
    const fromAt = extractHandle(name.startsWith("@") ? name : `@${name}`);
    if (fromAt && !name.includes(" ")) return fromAt;
  }
  const local = (email ?? "").split("@")[0] ?? "";
  if (HANDLE_RE.test(local)) return local;
  return "";
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
