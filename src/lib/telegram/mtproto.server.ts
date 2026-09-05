/** Server-only Telegram user client. Never import from client code. */
import { TelegramError } from "./errors";
import { floodWaitSeconds, mtprotoClientOpts } from "./mtproto-policy.server";

type Teleproto = typeof import("teleproto");

let libPromise: Promise<Teleproto> | null = null;

function loadLib(): Promise<Teleproto> {
  libPromise ??= import("teleproto").then((mod) => {
    const lib = (mod as { default?: Teleproto }).default ?? (mod as Teleproto);
    if (!lib?.TelegramClient || !lib.sessions) {
      throw new TelegramError("not_configured", "Telegram client failed to load on this server.", 500);
    }
    return lib;
  });
  return libPromise;
}

function clientOpts() {
  return mtprotoClientOpts();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TelegramError("flood", `Telegram took too long (${label}). Tap try again.`, 504));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function mapRpc(err: unknown): TelegramError {
  if (err instanceof TelegramError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toUpperCase();
  if (msg.includes("PHONE_NUMBER_INVALID") || msg.includes("PHONE_NUMBER_BANNED")) {
    return new TelegramError("invalid", "That phone number didn’t work. Check the country code.", 400);
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
  if (msg.includes("API_ID_INVALID") || msg.includes("API_ID_PUBLISHED_FLOOD")) {
    return new TelegramError(
      "invalid",
      "The Telegram app numbers didn’t work. Copy them again from my.telegram.org.",
      400,
    );
  }
  const wait = floodWaitSeconds(raw);
  if (wait != null) {
    return new TelegramError(
      "flood",
      `Telegram asked us to wait ${wait} second${wait === 1 ? "" : "s"}.`,
      429,
    );
  }
  if (msg.includes("FLOOD") || (msg.includes("WAIT") && msg.includes("SECOND"))) {
    return new TelegramError("flood", "Telegram asked us to wait. Try again in a few minutes.", 429);
  }
  if (msg.includes("AUTH_KEY") || msg.includes("SESSION_REVOKED") || msg.includes("SESSION_EXPIRED")) {
    return new TelegramError("unlinked", "Telegram signed this desk out. Connect again.", 401);
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
    return new TelegramError("flood", "Couldn't refresh Telegram just now.", 503);
  }
  if (msg.includes("CANNOT FIND PACKAGE") || msg.includes("CANNOT FIND MODULE")) {
    return new TelegramError("not_configured", "Telegram client failed to load on this server. Try again in a minute.", 500);
  }
  console.info("[telegram]", { event: "mtproto_error", message: raw.slice(0, 180) });
  return new TelegramError("invalid", "Telegram didn’t accept that. Try again.", 400);
}
