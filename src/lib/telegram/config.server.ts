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

export function telegramUserApp(): TelegramUserApp | null {
  const idRaw = env("TELEGRAM_API_ID");
  const apiHash = env("TELEGRAM_API_HASH");
  const apiId = idRaw ? Number(idRaw) : NaN;
  if (!Number.isInteger(apiId) || apiId < 1000 || apiId > 99_999_999) return null;
  if (!apiHash || apiHash.length < 16) return null;
  return { apiId, apiHash };
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
  return telegramOidcConfig() !== null || telegramUserApp() !== null;
}

export function publicOrigin(request: Request): string {
  const fromEnv = env("BETTER_AUTH_URL")?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function telegramRedirectUri(request: Request): string {
  return `${publicOrigin(request)}/api/telegram/oidc/callback`;
}
