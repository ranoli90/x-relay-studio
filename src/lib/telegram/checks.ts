export const TELEGRAM_CHECK_IDS = [
  "helper_alive",
  "its_you",
  "studio_notes",
  "helper_message",
  "see_chat",
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
    id: "helper_alive",
    title: "Helper is online",
    blurb: "We can reach the helper you just made.",
    required: true,
  },
  {
    id: "its_you",
    title: "We know it’s you",
    blurb: "You tapped Start, so this desk is tied to your Telegram.",
    required: true,
  },
  {
    id: "studio_notes",
    title: "Notes work here",
    blurb: "Your studio notes thread can save a message.",
    required: true,
  },
  {
    id: "helper_message",
    title: "Helper can write you",
    blurb: "A short ping from the helper to your Telegram.",
    required: true,
  },
  {
    id: "see_chat",
    title: "Helper can see the chat",
    blurb: "We can open the private chat between you and the helper.",
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
