import {
  DEFAULT_CONTEXT_RETENTION_DAYS,
  DEFAULT_GLOBAL_CONCURRENCY,
  DEFAULT_SESSION_SECONDS,
} from "./types.ts";

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

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Coordinator/UI. On in local/preview so the flow is testable; off in production until flagged. */
export function redditOnboardingEnabled(): boolean {
  const explicit = readFlag("REDDIT_ONBOARDING_ENABLED");
  if (explicit !== undefined) return explicit;
  return !isDeployed();
}

/** Live assisted execution. Always off unless explicitly enabled. */
export function redditAssistedSignupEnabled(): boolean {
  return readFlag("REDDIT_ASSISTED_SIGNUP_ENABLED") === true;
}

export function redditRemoteOauthEnabled(): boolean {
  return readFlag("REDDIT_REMOTE_OAUTH_ENABLED") === true;
}

export function redditBrowserProvider(): "fake" | "browserbase" {
  const raw = (process.env.REDDIT_BROWSER_PROVIDER || "").trim().toLowerCase();
  if (raw === "browserbase") return "browserbase";
  return "fake";
}

export function redditWorkflowVersion(): string {
  return (process.env.REDDIT_WORKFLOW_VERSION || "email-signup.v1").trim();
}

export function redditSessionMaxSeconds(): number {
  return readInt("REDDIT_SESSION_MAX_SECONDS", DEFAULT_SESSION_SECONDS);
}

export function redditGlobalConcurrency(): number {
  return readInt("REDDIT_ONBOARDING_GLOBAL_CONCURRENCY", DEFAULT_GLOBAL_CONCURRENCY);
}

export function redditContextRetentionDays(): number {
  return readInt("REDDIT_BROWSER_CONTEXT_RETENTION_DAYS", DEFAULT_CONTEXT_RETENTION_DAYS);
}

export function redditVaultKeyId(): string {
  return (process.env.REDDIT_VAULT_KEY_ID || "default").trim() || "default";
}

export function browserbaseConfigured(): boolean {
  return Boolean(
    process.env.BROWSERBASE_API_KEY?.trim() && process.env.BROWSERBASE_PROJECT_ID?.trim(),
  );
}

export function environmentId(): string {
  if (process.env.VERCEL_ENV?.trim()) return process.env.VERCEL_ENV.trim();
  if (isDeployed()) return "production";
  return "preview";
}

export function productionForbidsFakeProvider(): boolean {
  return isDeployed() && redditBrowserProvider() === "fake" && redditAssistedSignupEnabled();
}

export function allowLegacyPlaintextSecrets(): boolean {
  if (isDeployed()) return false;
  return readFlag("SECRETS_ALLOW_LEGACY_PLAINTEXT") === true;
}

export function onboardingFixtureEnabled(): boolean {
  if (isDeployed()) return false;
  return readFlag("REDDIT_ONBOARDING_FIXTURE") === true;
}
