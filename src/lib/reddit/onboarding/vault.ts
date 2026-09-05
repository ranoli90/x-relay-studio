import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { allowLegacyPlaintextSecrets, redditVaultKeyId } from "./config.ts";
import type { SecretPurpose } from "./types.ts";

const V1 = "v1";
const V2 = "v2";
const INFO_V1 = "x-relay-studio/envelope/v1";
const INFO_V2 = "x-relay-studio/envelope/v2";

export type AssociatedData = {
  userId: string;
  recordId: string;
  purpose: string;
};

function isProduction(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

function secretMaterial(): string {
  const env =
    process.env.SECRETS_ENCRYPTION_KEY?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (env) return env;
  if (isProduction()) {
    throw new Error("SECRETS_ENCRYPTION_KEY is required to encrypt tokens at rest.");
  }
  const g = globalThis as typeof globalThis & { __grokPreviewSecret__?: string };
  g.__grokPreviewSecret__ ??= randomBytes(32).toString("hex");
  return g.__grokPreviewSecret__;
}

function keyFor(info: string): Buffer {
  const material = Buffer.from(secretMaterial(), "utf8");
  const salt = createHash("sha256").update("x-relay-studio").digest();
  return Buffer.from(hkdfSync("sha256", material, salt, info, 32));
}

function aadBytes(aad: AssociatedData, version: string): Buffer {
  return Buffer.from(`${aad.userId}|${aad.purpose}|${aad.recordId}|${version}`, "utf8");
}

export function isV2Envelope(blob: string): boolean {
  const parts = blob.split(".");
  return parts.length === 5 && parts[0] === V2;
}

export function isV1Envelope(blob: string): boolean {
  const parts = blob.split(".");
  return parts.length === 4 && parts[0] === V1;
}

export function encryptV2(plain: string, aad: AssociatedData, keyId = redditVaultKeyId()): string {
  if (!plain) throw new Error("Refusing to encrypt an empty secret.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(INFO_V2), iv);
  cipher.setAAD(aadBytes(aad, V2));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [V2, keyId, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptV2(blob: string, aad: AssociatedData): string {
  if (!isV2Envelope(blob)) throw new SecretDecryptError("NOT_V2");
  const parts = blob.split(".");
  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const ct = Buffer.from(parts[4], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(INFO_V2), iv);
  decipher.setAAD(aadBytes(aad, V2));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptError("AUTH_FAILED");
  }
}

export function encryptV1(plain: string): string {
  if (!plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(INFO_V1), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [V1, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptV1(blob: string): string {
  if (!isV1Envelope(blob)) throw new SecretDecryptError("NOT_V1");
  const parts = blob.split(".");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(INFO_V1), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptError("AUTH_FAILED");
  }
}

export class SecretDecryptError extends Error {
  code: string;
  constructor(code: string) {
    super("Stored secret could not be opened.");
    this.name = "SecretDecryptError";
    this.code = code;
  }
}

/** Fail closed. Never returns ciphertext as plaintext. */
export function decryptSecretStrict(blob: string, aad?: AssociatedData): string {
  if (!blob) return "";
  if (isV2Envelope(blob)) {
    if (!aad) throw new SecretDecryptError("AAD_REQUIRED");
    return decryptV2(blob, aad);
  }
  if (isV1Envelope(blob)) return decryptV1(blob);
  if (allowLegacyPlaintextSecrets()) return blob;
  throw new SecretDecryptError("LEGACY_PLAINTEXT_DISABLED");
}

export function wrapExisting(blob: string, aad: AssociatedData): { ciphertext: string; envelopeVersion: string } {
  const plain = decryptSecretStrict(blob, aad);
  return { ciphertext: encryptV2(plain, aad), envelopeVersion: V2 };
}

export function purposeAllowed(purpose: string): purpose is SecretPurpose {
  return (
    purpose === "signup_email" ||
    purpose === "temporary_signup_password" ||
    purpose === "retained_reddit_password" ||
    purpose === "oauth_revocation_material"
  );
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "•••";
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  const shown = user.slice(0, 1);
  return `${shown}•••@${domain}`;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashIdempotency(ownerId: string, operation: string, key: string): string {
  return sha256Hex(`${ownerId}|${operation}|${key}`);
}

export function hashFingerprint(body: unknown): string {
  return sha256Hex(JSON.stringify(body));
}
