import { TelegramError } from "./errors.ts";
import {
  floodWaitSeconds,
  isAccountFrozen,
  isAuthKeyDuplicated,
  isDcConnectFailure,
  isPeerFlood,
} from "./mtproto-policy.server.ts";

export function mapRpc(err: unknown): TelegramError {
  if (err instanceof TelegramError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toUpperCase();
  if (msg.includes("PHONE_NUMBER_INVALID") || msg.includes("PHONE_NUMBER_BANNED")) {
    return new TelegramError("invalid", "That phone number didn’t work. Check the country code.", 400);
  }
  if (msg.includes("PHONE_NUMBER_FLOODED") || msg.includes("PHONE_PASSWORD_FLOOD") || msg.includes("PHONE_NUMBER_UNOCCUPIED")) {
    return new TelegramError(
      "flood",
      "Telegram is blocking login codes for this app right now. Wait, then use a new Web api_id from my.telegram.org.",
      429,
      3600,
    );
  }
  if (msg.includes("PHONE_CODE_INVALID") || msg.includes("PHONE_CODE_EMPTY")) {
    return new TelegramError("invalid", "That login code didn’t match. Try again.", 400);
  }
  if (msg.includes("PHONE_CODE_EXPIRED")) {
    return new TelegramError("telegram_login_expired", "That login code expired. Send a new one.", 401);
  }
  if (msg.includes("PASSWORD_HASH_INVALID") || msg.includes("PASSWORD_EMPTY")) {
    return new TelegramError("invalid", "That cloud password didn’t match.", 400);
  }
  if (msg.includes("SESSION_PASSWORD_NEEDED") || msg.includes("PASSWORD_REQUIRED")) {
    return new TelegramError("password", "Cloud password required.", 401);
  }
  if (msg.includes("API_ID_INVALID") || msg.includes("API_ID_PUBLISHED_FLOOD")) {
    return new TelegramError(
      "invalid",
      "The Telegram app numbers didn’t work. Copy them again from my.telegram.org.",
      400,
    );
  }
  if (isPeerFlood(raw)) {
    return new TelegramError(
      "peer_flood",
      "Telegram paused sending from this account. Wait before messaging new people.",
      429,
      3600,
    );
  }
  if (isAccountFrozen(raw) || isAuthKeyDuplicated(raw)) {
    return new TelegramError("auth_dead", "Telegram signed this desk out. Connect again.", 401);
  }
  const wait = floodWaitSeconds(raw);
  if (wait != null) {
    return new TelegramError(
      "flood",
      `Telegram asked us to wait ${wait} second${wait === 1 ? "" : "s"}.`,
      429,
      wait,
    );
  }
  if (msg.includes("FLOOD") || (msg.includes("WAIT") && msg.includes("SECOND"))) {
    return new TelegramError("flood", "Telegram asked us to wait. Try again in a few minutes.", 429, 120);
  }
  if (msg.includes("AUTH_KEY") || msg.includes("SESSION_REVOKED") || msg.includes("SESSION_EXPIRED")) {
    return new TelegramError("unlinked", "Telegram signed this desk out. Connect again.", 401);
  }
  if (isDcConnectFailure(raw)) {
    return new TelegramError(
      "flood",
      "Telegram’s data center didn’t answer. Tap try again in a few seconds.",
      503,
      8,
    );
  }
  if (
    msg.includes("CONNECTION") ||
    msg.includes("CONNECT") ||
    msg.includes("NETSOCKET") ||
    msg.includes("WAS LOST") ||
    msg.includes("TOOK TOO LONG") ||
    msg.includes("ECONN") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("TIMEOUT") ||
    msg.includes(" DC ")
  ) {
    return new TelegramError("flood", "Couldn't reach Telegram just now. Try again.", 503, 8);
  }
  if (msg.includes("CANNOT FIND PACKAGE") || msg.includes("CANNOT FIND MODULE")) {
    return new TelegramError("not_configured", "Telegram client failed to load on this server. Try again in a minute.", 500);
  }
  console.info("[telegram]", { event: "mtproto_error", message: raw.slice(0, 180) });
  return new TelegramError("invalid", "Telegram didn’t accept that. Try again.", 400);
}
