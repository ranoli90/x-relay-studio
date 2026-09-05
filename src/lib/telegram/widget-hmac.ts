import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SEC = 86_400;

export type WidgetPayload = Record<string, string>;

export type WidgetVerifyOk = { ok: true; data: WidgetPayload };
export type WidgetVerifyFail = { ok: false; error: "bad_hash" | "stale" | "missing" };
export type WidgetVerifyResult = WidgetVerifyOk | WidgetVerifyFail;

/** Legacy Login Widget HMAC. Prefer OIDC. Timing-safe. */
export function verifyTelegramWidget(
  payload: WidgetPayload,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000),
): WidgetVerifyResult {
  const hash = payload.hash;
  if (!hash || !botToken) return { ok: false, error: "missing" };

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate) || nowSec - authDate > MAX_AGE_SEC) {
    return { ok: false, error: "stale" };
  }

  const checkString = Object.keys(payload)
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const digest = createHmac("sha256", secretKey).update(checkString).digest("hex");

  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: "bad_hash" };
  }
  return { ok: true, data: payload };
}
