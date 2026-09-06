import { onboardingFixtureEnabled } from "./onboarding/config.ts";

export function callbackPath() {
  return "/api/reddit/oauth/callback";
}

export function redirectUriFromOrigin(origin: string) {
  return `${origin.replace(/\/$/, "")}${callbackPath()}`;
}

function configuredOrigins(): string[] {
  const primary = (process.env.BETTER_AUTH_URL || process.env.APP_ORIGIN || "")
    .trim()
    .replace(/\/$/, "");
  const extras = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return [...new Set([primary, ...extras].filter(Boolean))];
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function originFromRequest(request: Request) {
  const allowed = configuredOrigins();
  if (allowed[0]) {
    return originOf(allowed[0]) ?? allowed[0];
  }
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return url.origin;
  }
  throw new Error("Set BETTER_AUTH_URL or APP_ORIGIN before connecting Reddit.");
}

export function isPlausibleOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (onboardingFixtureEnabled()) return true;
    const allowed = configuredOrigins();
    if (allowed.length === 0) {
      return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    }
    return allowed.some((entry) => originOf(entry) === parsed.origin);
  } catch {
    return false;
  }
}
