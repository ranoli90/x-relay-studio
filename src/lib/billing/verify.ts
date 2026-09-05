import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { MIN_INVOICE_WITH_FOLLOW_CENTS } from "./catalog.ts";

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

/** PHP `html_entity_decode` (ENT_COMPAT) on Plisio `tx_urls`. */
export function decodePlisioTxUrls(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

export function plisioCanonical(payload: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    if (key === "verify_hash") continue;
    let value = payload[key];
    if (key === "expire_utc" && value != null) value = String(value);
    if (key === "tx_urls") value = decodePlisioTxUrls(value);
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

/** JSON callback (`?json=true`): ksort, drop verify_hash, decode tx_urls entities, JSON.stringify. */
export function plisioJsonCanonical(payload: Record<string, unknown>): string {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    if (key === "verify_hash") continue;
    let value = payload[key];
    if (key === "expire_utc" && value != null) value = String(value);
    if (key === "tx_urls") value = decodePlisioTxUrls(value);
    copy[key] = value;
  }
  return JSON.stringify(copy);
}

export function plisioJsonSignature(secret: string, payload: Record<string, unknown>): string {
  return createHmac("sha1", secret).update(plisioJsonCanonical(payload), "utf8").digest("hex");
}

export function plisioJsonValid(secret: string, payload: Record<string, unknown>): boolean {
  if (!secret) return false;
  const hash = payload.verify_hash;
  if (typeof hash !== "string" || !hash) return false;
  return safeEqHex(plisioJsonSignature(secret, payload), hash);
}

/** Form callbacks use PHP serialize; `?json=true` uses JSON.stringify of the same ksort. */
export function plisioCallbackValid(secret: string, payload: Record<string, unknown>): boolean {
  return plisioValid(secret, payload) || plisioJsonValid(secret, payload);
}

export type PaidRejectReason =
  | "bad_signature"
  | "bad_status"
  | "underpay"
  | "expired"
  | "amount_mismatch"
  | "unbound"
  | "too_small"
  | "uncertain";

export type PaidVerdict = { accept: true; replay: boolean } | { accept: false; reason: PaidRejectReason };

const PAID_STATUS = new Set(["paid", "completed"]);
const EXPIRED_STATUS = new Set(["expired", "cancelled", "canceled"]);
const PENDING_STATUS = new Set(["new", "pending", "pending internal", "pending_internal", "pendinginternal"]);
const MISMATCH_STATUS = new Set(["mismatch", "underpay"]);

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
  const status = event.status.toLowerCase().trim();
  if (EXPIRED_STATUS.has(status)) {
    return { accept: false, reason: "expired" };
  }
  const short = event.paidAmountCents + 1 < event.invoiceAmountCents;
  if (MISMATCH_STATUS.has(status) && short) {
    return { accept: false, reason: "underpay" };
  }
  if (PENDING_STATUS.has(status)) {
    return { accept: false, reason: "bad_status" };
  }
  const paidLike = PAID_STATUS.has(status) || (MISMATCH_STATUS.has(status) && !short);
  if (!paidLike) {
    return { accept: false, reason: "uncertain" };
  }
  if (event.invoiceAmountCents < MIN_INVOICE_WITH_FOLLOW_CENTS) return { accept: false, reason: "too_small" };
  if (short) {
    return { accept: false, reason: "underpay" };
  }
  if (event.invoiceAmountCents <= 0) return { accept: false, reason: "amount_mismatch" };
  if (event.alreadyMinted) return { accept: true, replay: true };
  return { accept: true, replay: false };
}

const PERMANENT = new Set([
  "replay",
  "unbound",
  "bad_signature",
  "underpay",
  "expired",
  "amount_mismatch",
  "too_small",
  "bad_status",
  "uncertain",
]);

/** 4xx for permanent rejects so Plisio does not retry-mint; 5xx for transients. */
export function plisioCallbackHttpStatus(result: {
  ok: boolean;
  reason?: string;
  replay?: boolean;
  minted?: number;
}): number {
  if (result.ok || result.replay || result.reason === "replay") return 200;
  if (result.reason && PERMANENT.has(result.reason)) return 400;
  return 500;
}
