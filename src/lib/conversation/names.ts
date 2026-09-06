const PLACEHOLDERS = new Set(
  [
    "account",
    "unknown",
    "telegram",
    "user",
    "you",
    "chat",
    "group",
    "channel",
    "bot",
    "deleted",
    "null",
    "undefined",
    "contact",
    "partner",
    "fan",
    "customer",
  ].map((s) => s.toLowerCase()),
);

export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  if (PLACEHOLDERS.has(n.toLowerCase())) return true;
  if (/^user[_-]?\d+$/i.test(n)) return true;
  if (/^telegram/i.test(n)) return true;
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(n)) return true;
  if (n.length === 1) return true;
  return false;
}

/** First token only when it is a plausible personal name, never a channel title. */
export function spokenName(displayName: string | null | undefined, preferred?: string | null): string | null {
  const pref = preferred?.trim();
  if (pref && !isPlaceholderName(pref)) return pref.split(/\s+/)[0] ?? pref;
  const n = (displayName ?? "").trim();
  if (!n || isPlaceholderName(n)) return null;
  if (/[\d@/\\]/.test(n)) return null;
  const first = n.split(/\s+/)[0] ?? "";
  if (!first || isPlaceholderName(first)) return null;
  if (!/^[A-Za-z][A-Za-z'.-]{1,20}$/.test(first)) return null;
  return first;
}
