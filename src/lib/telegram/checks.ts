export const TELEGRAM_CHECK_IDS = [
  "signed_in",
  "chats_visible",
  "messages_readable",
  "watching_on",
  "openrouter_ready",
] as const;

export type TelegramCheckId = (typeof TELEGRAM_CHECK_IDS)[number];

export type TelegramCheckMeta = {
  id: TelegramCheckId;
  title: string;
  blurb: string;
  required: boolean;
};

export const TELEGRAM_CHECKS: TelegramCheckMeta[] = [
  {
    id: "signed_in",
    title: "This is your Telegram",
    blurb: "We can see the account you just signed in with.",
    required: true,
  },
  {
    id: "chats_visible",
    title: "Chats are visible",
    blurb: "Your real conversations can be listed here.",
    required: true,
  },
  {
    id: "messages_readable",
    title: "Messages can be read",
    blurb: "Recent messages from Telegram landed on this desk.",
    required: true,
  },
  {
    id: "watching_on",
    title: "Watching is on",
    blurb: "New messages will keep arriving while this desk is open.",
    required: true,
  },
  {
    id: "openrouter_ready",
    title: "OpenRouter key works",
    blurb: "Saved for the decision layer. Nothing is sent to it yet.",
    required: false,
  },
];

export const REQUIRED_CHECK_IDS: TelegramCheckId[] = TELEGRAM_CHECKS.filter((c) => c.required).map(
  (c) => c.id,
);

export type TelegramCheckResult = {
  id: TelegramCheckId;
  ok: boolean | null;
  detail: string | null;
  ranAt: string | null;
};

export function emptyCheckResults(): TelegramCheckResult[] {
  return TELEGRAM_CHECKS.map((c) => ({
    id: c.id,
    ok: null,
    detail: null,
    ranAt: null,
  }));
}

export function mergeCheckResults(
  stored: Partial<Record<TelegramCheckId, Omit<TelegramCheckResult, "id">>> | TelegramCheckResult[],
): TelegramCheckResult[] {
  const byId = new Map<TelegramCheckId, TelegramCheckResult>();
  if (Array.isArray(stored)) {
    for (const row of stored) byId.set(row.id, row);
  } else {
    for (const id of TELEGRAM_CHECK_IDS) {
      const row = stored[id];
      if (row) byId.set(id, { id, ...row });
    }
  }
  return TELEGRAM_CHECKS.map((meta) => {
    const existing = byId.get(meta.id);
    return existing ?? { id: meta.id, ok: null, detail: null, ranAt: null };
  });
}

export function requiredChecksPassed(results: TelegramCheckResult[]): boolean {
  const byId = new Map(results.map((r) => [r.id, r]));
  return REQUIRED_CHECK_IDS.every((id) => byId.get(id)?.ok === true);
}

export function parseChecksJson(raw: string | null | undefined): TelegramCheckResult[] {
  if (!raw) return emptyCheckResults();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return mergeCheckResults(parsed as TelegramCheckResult[]);
    if (parsed && typeof parsed === "object") {
      return mergeCheckResults(parsed as Partial<Record<TelegramCheckId, Omit<TelegramCheckResult, "id">>>);
    }
  } catch {
    // ignore corrupt rows
  }
  return emptyCheckResults();
}
