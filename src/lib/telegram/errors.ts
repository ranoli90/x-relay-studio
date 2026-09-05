export type TelegramErrorCode =
  | "not_configured"
  | "unauthorized"
  | "telegram_login_expired"
  | "telegram_denied"
  | "telegram_in_use"
  | "flood"
  | "invalid"
  | "unlinked"
  | "bad_key"
  | "hello_wait"
  | "checks_incomplete"
  | "password";

export class TelegramError extends Error {
  readonly code: TelegramErrorCode;
  readonly status: number;
  readonly floodSeconds?: number;

  constructor(code: TelegramErrorCode, message: string, status = 400, floodSeconds?: number) {
    super(message);
    this.name = "TelegramError";
    this.code = code;
    this.status = status;
    this.floodSeconds = floodSeconds;
  }
}

export function errorQuery(code: TelegramErrorCode): string {
  return `/telegram?error=${encodeURIComponent(code)}`;
}
