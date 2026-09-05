import { TelegramError } from "./errors.ts";
import { safeHttpUrl } from "./validate.ts";

const LOGIN_MAX_AGE_SEC = 5 * 60;

export type TelegramOidcProfile = {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  botCanWrite: boolean;
};

/** Pure OIDC claim checks — nonce required, timestamps fresh, picture https-only. */
export function assertOidcPayload(
  payload: Record<string, unknown>,
  nonce: string,
  nowSec = Math.floor(Date.now() / 1000),
): TelegramOidcProfile {
  if (typeof nonce !== "string" || nonce.length < 8) {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }
  if (typeof payload.nonce !== "string" || payload.nonce !== nonce) {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }

  const iat = typeof payload.iat === "number" ? payload.iat : null;
  const authRaw = payload.auth_date;
  const authDate =
    typeof authRaw === "number"
      ? authRaw
      : typeof authRaw === "string"
        ? Number(authRaw)
        : iat;
  if (!authDate || !Number.isFinite(authDate)) {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }
  if (nowSec - authDate > LOGIN_MAX_AGE_SEC || (iat != null && nowSec - iat > LOGIN_MAX_AGE_SEC)) {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }
  if (authDate - nowSec > 60 || (iat != null && iat - nowSec > 60)) {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }

  const idRaw = payload.id ?? payload.sub;
  const telegramUserId = Number(idRaw);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    throw new TelegramError("invalid", "Telegram identity was incomplete.", 400);
  }

  const given = typeof payload.given_name === "string" ? payload.given_name.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const firstName = given || name.split(/\s+/)[0] || "Telegram";
  const lastName =
    typeof payload.family_name === "string" && payload.family_name.trim()
      ? payload.family_name.trim()
      : name.includes(" ")
        ? name.split(/\s+/).slice(1).join(" ")
        : null;
  const preferred =
    typeof payload.preferred_username === "string"
      ? payload.preferred_username.replace(/^@/, "").trim()
      : "";
  const username = preferred || null;
  const photoUrl = safeHttpUrl(typeof payload.picture === "string" ? payload.picture : null);

  return {
    telegramUserId,
    firstName: firstName.slice(0, 64),
    lastName: lastName ? lastName.slice(0, 64) : null,
    username,
    photoUrl,
    botCanWrite: false,
  };
}
