import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function safeEqHex(a: string, b: string): boolean {
  const left = Buffer.from(a.toLowerCase());
  const right = Buffer.from(b.toLowerCase());
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** Crypto Pay: HMAC-SHA256(SHA256(token), raw_body) vs crypto-pay-api-signature. */
export function cryptobotSignature(token: string, rawBody: string): string {
  const secret = createHash("sha256").update(token, "utf8").digest();
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function cryptobotValid(token: string, rawBody: string, header: string | null): boolean {
  if (!token || !header) return false;
  return safeEqHex(cryptobotSignature(token, rawBody), header.trim());
}

function byteLen(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** PHP serialize subset used by Plisio verify_hash. */
export function phpSerialize(value: unknown): string {
  if (value === null || value === undefined) return "N;";
  if (typeof value === "boolean") return value ? "b:1;" : "b:0;";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return `i:${value};`;
    return `d:${value};`;
  }
  if (typeof value === "string") return `s:${byteLen(value)}:"${value}";`;
  if (Array.isArray(value)) {
    const parts = value.map((item, i) => phpSerialize(i) + phpSerialize(item));
    return `a:${value.length}:{${parts.join("")}}`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const parts = entries.map(([k, v]) => phpSerialize(k) + phpSerialize(v));
    return `a:${entries.length}:{${parts.join("")}}`;
  }
  return "N;";
}

export function plisioCanonical(payload: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    if (key === "verify_hash") continue;
    let value = payload[key];
    if (key === "expire_utc" && value != null) value = String(value);
    copy[key] = value;
  }
  return copy;
}

export function plisioSignature(secret: string, payload: Record<string, unknown>): string {
  const body = phpSerialize(plisioCanonical(payload));
  return createHmac("sha1", secret).update(body, "utf8").digest("hex");
}

export function plisioValid(secret: string, payload: Record<string, unknown>): boolean {
  if (!secret) return false;
  const hash = payload.verify_hash;
  if (typeof hash !== "string" || !hash) return false;
  return safeEqHex(plisioSignature(secret, payload), hash);
}

export type PaidVerdict =
  | { accept: true; replay: boolean }
  | { accept: false; reason: "bad_signature" | "bad_status" | "underpay" | "expired" | "amount_mismatch" | "unbound" | "too_small" };

export function acceptPaid(event: {
  signatureOk: boolean;
  status: string;
  invoiceAmountCents: number;
  paidAmountCents: number;
  alreadyMinted: boolean;
  deskUserId: string | null;
  expired: boolean;
}): PaidVerdict {
  if (!event.signatureOk) return { accept: false, reason: "bad_signature" };
  if (!event.deskUserId) return { accept: false, reason: "unbound" };
  if (event.expired) return { accept: false, reason: "expired" };
  const status = event.status.toLowerCase();
  if (status === "expired" || status === "cancelled" || status === "canceled") {
    return { accept: false, reason: "expired" };
  }
  if (status !== "paid" && status !== "completed") {
    return { accept: false, reason: "bad_status" };
  }
  if (event.invoiceAmountCents < 2400) return { accept: false, reason: "too_small" };
  if (event.paidAmountCents + 1 < event.invoiceAmountCents) {
    return { accept: false, reason: "underpay" };
  }
  if (event.invoiceAmountCents <= 0) return { accept: false, reason: "amount_mismatch" };
  if (event.alreadyMinted) return { accept: true, replay: true };
  return { accept: true, replay: false };
}
