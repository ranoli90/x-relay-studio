import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PREFIX = "v1";
const INFO = "x-relay-studio/envelope/v1";

function isProduction(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

function secretMaterial(): string {
  const env =
    process.env.SECRETS_ENCRYPTION_KEY?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (env) return env;
  if (isProduction()) {
    throw new Error("BETTER_AUTH_SECRET is required to encrypt tokens at rest.");
  }
  const g = globalThis as typeof globalThis & { __grokPreviewSecret__?: string };
  g.__grokPreviewSecret__ ??= randomBytes(32).toString("hex");
  return g.__grokPreviewSecret__;
}

function key(): Buffer {
  const material = Buffer.from(secretMaterial(), "utf8");
  const salt = createHash("sha256").update("x-relay-studio").digest();
  return Buffer.from(hkdfSync("sha256", material, salt, INFO, 32));
}

/** AES-256-GCM envelope. Output `v1.<iv>.<tag>.<ct>` base64url. */
export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(
    ".",
  );
}

export class SecretOpenError extends Error {
  constructor(message = "Stored secret could not be opened.") {
    super(message);
    this.name = "SecretOpenError";
  }
}

function allowLegacyPlaintext(): boolean {
  if (isProduction()) return false;
  const raw = process.env.SECRETS_ALLOW_LEGACY_PLAINTEXT?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on";
}

/**
 * Fail closed. A bad key or damaged ciphertext is never treated as plaintext.
 * Legacy non-envelope values are only readable when explicitly allowed outside production.
 */
export function decryptSecret(blob: string): string {
  if (!blob) return blob;
  if (!isEnvelope(blob)) {
    if (allowLegacyPlaintext()) return blob;
    throw new SecretOpenError("Plaintext secret fallback is disabled.");
  }
  const parts = blob.split(".");
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretOpenError();
  }
}

export function isEnvelope(blob: string): boolean {
  const parts = blob.split(".");
  return parts.length === 4 && parts[0] === PREFIX;
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
