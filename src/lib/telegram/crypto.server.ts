import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1";

function secretMaterial(): string {
  const env = process.env.BETTER_AUTH_SECRET?.trim();
  if (env) return env;
  const g = globalThis as typeof globalThis & { __grokAuthPreviewSecret__?: string };
  g.__grokAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return g.__grokAuthPreviewSecret__;
}

function key(): Buffer {
  return createHash("sha256").update(secretMaterial()).digest();
}

/** AES-256-GCM. Output `v1.<iv>.<tag>.<ct>` base64url. Never log the plaintext. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(
    ".",
  );
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("bad_blob");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
