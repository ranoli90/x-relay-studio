import type { TelegramOnboardingStep } from "./types";

export const ONBOARDING_DRAFT_KEY = "xrelay-tg-onboarding";

const STEPS: TelegramOnboardingStep[] = [
  "welcome",
  "app",
  "phone",
  "code",
  "password",
  "checks",
  "done",
];

export type TelegramOnboardingDraft = {
  step: TelegramOnboardingStep;
  apiId: string;
  apiHash: string;
  phone: string;
};

const EMPTY: TelegramOnboardingDraft = {
  step: "welcome",
  apiId: "",
  apiHash: "",
  phone: "",
};

function isStep(value: unknown): value is TelegramOnboardingStep {
  return typeof value === "string" && (STEPS as string[]).includes(value);
}

export function parseOnboardingDraft(raw: unknown): TelegramOnboardingDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!isStep(row.step) || row.step === "done" || row.step === "password") return null;
  return {
    step: row.step,
    apiId: typeof row.apiId === "string" ? row.apiId.slice(0, 12) : "",
    apiHash: typeof row.apiHash === "string" ? row.apiHash.slice(0, 64) : "",
    phone: typeof row.phone === "string" ? row.phone.slice(0, 24) : "",
  };
}

export function stepIndex(step: TelegramOnboardingStep): number {
  return STEPS.indexOf(step);
}

/** Keep the further-along of server vs local, but never restore a password screen. */
export function mergeOnboardingStep(
  server: TelegramOnboardingStep,
  local: TelegramOnboardingStep | null,
): TelegramOnboardingStep {
  if (!local || local === "password" || local === "done") return server;
  if (server === "done") return "checks";
  if (server === "password") return "password";
  return stepIndex(server) >= stepIndex(local) ? server : local;
}

export function readOnboardingDraft(): TelegramOnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return null;
    return parseOnboardingDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeOnboardingDraft(draft: TelegramOnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({ ...draft, apiHash: "" }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearOnboardingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function emptyOnboardingDraft(): TelegramOnboardingDraft {
  return { ...EMPTY };
}
