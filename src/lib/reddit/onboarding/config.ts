import {
  DEFAULT_CONTEXT_RETENTION_DAYS,
  DEFAULT_GLOBAL_CONCURRENCY,
  DEFAULT_SESSION_SECONDS,
} from "./types.ts";

/**
 * Hosted isolation class used by defaults.
 *
 * `VERCEL` is set on every Vercel deployment, including preview URLs.
 * `isDeployed()` therefore treats production *and* hosted preview as deployed.
 * That is intentional: do not weaken production isolation so a preview
 * comment can default the coordinator on.
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

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Environment class for operators. Distinct from the onboarding default.
 *
 * - `production`: `VERCEL_ENV=production`, or `VERCEL`/`NODE_ENV=production`
 *   without a preview label
 * - `hosted_preview`: `VERCEL_ENV=preview` (still deployed; isolation holds)
 * - `local`: no Vercel, not production Node
 * - `fixture`: local-only fixture site (`REDDIT_ONBOARDING_FIXTURE`)
 */
export type RedditRuntimeClass = "production" | "hosted_preview" | "local" | "fixture";

export function redditRuntimeClass(): RedditRuntimeClass {
  if (onboardingFixtureEnabled()) return "fixture";
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv === "preview") return "hosted_preview";
  if (vercelEnv === "production" || isDeployed()) return "production";
  return "local";
}

/**
 * Coordinator/UI. Default on only in local non-deployed development.
 * Vercel (including preview) and production stay off unless REDDIT_ONBOARDING_ENABLED is explicit.
 * Do not treat a hosted preview as locally testable.
 */
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

/** Isolated fixture only. Live/hosted stays needs_review until a real approval record exists. */
export function assistedApprovalStatus(): "approved" | "needs_review" {
  return onboardingFixtureEnabled() ? "approved" : "needs_review";
}

function fixtureListenPort(): string {
  const raw = (process.env.REDDIT_ONBOARDING_FIXTURE_PORT || process.env.PORT || "8080").trim();
  return /^\d{2,5}$/.test(raw) ? raw : "8080";
}

/** Full origins (scheme + host + port) allowed only while isolated fixture mode is on. */
export function fixtureOriginAllowlist(): string[] {
  if (!onboardingFixtureEnabled()) return [];
  const port = fixtureListenPort();
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/** OpenRouter draft composer. Off unless explicitly enabled. Never triggered by signup. */
export function redditDraftingEnabled(): boolean {
  return readFlag("REDDIT_DRAFTING_ENABLED") === true;
}

/** Direct Reddit publish. Stays off unless a separate approval gate enables it. */
export function redditPublishEnabled(): boolean {
  return readFlag("REDDIT_PUBLISH_ENABLED") === true;
}

/** Managed recovery-email alias/inbox. Existing owner inboxes work without this. */
export function redditEmailBindingEnabled(): boolean {
  return readFlag("REDDIT_EMAIL_BINDING_ENABLED") === true;
}
