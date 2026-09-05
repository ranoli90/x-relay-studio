import { sha256Hex, timingSafeEqualString } from "../secrets.ts";

const HEX64 = /^[a-f0-9]{64}$/;

export function hashWebhookSecret(secret: string): string {
  return sha256Hex(secret);
}

export function looksHashedWebhookSecret(value: string | null | undefined): boolean {
  return Boolean(value && HEX64.test(value));
}

/** Compare the Telegram header token against a stored hash or legacy plaintext. */
export function webhookSecretMatches(header: string, stored: string | null | undefined): boolean {
  if (!header || !stored) return false;
  if (looksHashedWebhookSecret(stored)) {
    return timingSafeEqualString(hashWebhookSecret(header), stored);
  }
  return timingSafeEqualString(header, stored);
}
