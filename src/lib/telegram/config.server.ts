/** Server-only Telegram credentials. Never import from client code. */

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

export type TelegramOidcConfig = {
  clientId: string;
  clientSecret: string;
  botToken: string | null;
};

export type TelegramUserApp = {
  apiId: number;
  apiHash: string;
};

export function telegramMtprotoEnabled(): boolean {
  return env("TELEGRAM_MTPROTO_ENABLED") !== "false";
}

/**
 * Per-desk api_id / api_hash only. A shared Vercel TELEGRAM_API_ID clusters
 * every signed-out desk onto one unofficial client and Telegram then blocks
 * sendCode for every number.
 */
export function telegramUserApp(): TelegramUserApp | null {
  return null;
}

export function telegramOidcConfig(): TelegramOidcConfig | null {
  const botToken = env("TELEGRAM_BOT_TOKEN") ?? null;
  const clientId =
    env("TELEGRAM_CLIENT_ID") ??
    env("TELEGRAM_BOT_ID") ??
    (botToken ? botToken.split(":")[0] : undefined);
  const clientSecret = env("TELEGRAM_CLIENT_SECRET") ?? botToken ?? undefined;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, botToken };
}

export function telegramConfigured(): boolean {
  return telegramOidcConfig() !== null || telegramMtprotoEnabled();
}

function configuredOrigin(): string | null {
  const raw = env("BETTER_AUTH_URL") ?? env("APP_ORIGIN");
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function publicOrigin(request: Request): string {
  const fromEnv = configuredOrigin();
  if (fromEnv) return fromEnv;
  const url = new URL(request.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return url.origin;
  }
  throw new Error("Set BETTER_AUTH_URL or APP_ORIGIN before connecting Telegram.");
}

export function telegramRedirectUri(request: Request): string {
  return `${publicOrigin(request)}/api/telegram/oidc/callback`;
}
