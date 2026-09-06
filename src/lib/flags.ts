/**
 * Kill switches. Production defaults are fail-closed for unofficial X
 * lookup. Everything else stays on unless the operator sets `false`.
 */

function isDeployed(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

function readFlag(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "true" || raw === "1" || raw === "on" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return undefined;
}

export function unofficialXLookupEnabled(): boolean {
  const explicit = readFlag("FXTWITTER_ENABLED");
  if (explicit !== undefined) return explicit;
  return !isDeployed();
}

export function telegramMtprotoEnabled(): boolean {
  return readFlag("TELEGRAM_MTPROTO_ENABLED") !== false;
}

export function redditConnectorEnabled(): boolean {
  return readFlag("REDDIT_ENABLED") !== false;
}

export function cronJobsEnabled(): boolean {
  return readFlag("CRON_ENABLED") !== false;
}

export function openRouterEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim()) && readFlag("OPENROUTER_ENABLED") !== false;
}

/** Hold switch for studio scrape / drip / fill ticks. Off stops external callers. */
export function studioTickEnabled(): boolean {
  return readFlag("STUDIO_TICK_ENABLED") !== false;
}

/**
 * Coordinator/UI. On in local/preview so the flow is testable; off in production
 * until flagged. Mirrors src/lib/reddit/onboarding/config.ts.
 */
export function redditOnboardingUiEnabled(): boolean {
  const explicit = readFlag("REDDIT_ONBOARDING_ENABLED");
  if (explicit !== undefined) return explicit;
  return !isDeployed();
}

export function redditAssistedSignupEnabled(): boolean {
  return readFlag("REDDIT_ASSISTED_SIGNUP_ENABLED") === true;
}

/**
 * X never auto-posts. Outbox "sent" is operator-acked after a manual draft.
 * Not an env flag — cannot be turned on.
 */
export function xAutoPostEnabled(): boolean {
  return false;
}
