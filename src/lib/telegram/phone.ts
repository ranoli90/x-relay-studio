/** Normalize a phone to E.164. Client-safe. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hadPlus = /\+/.test(trimmed);
  const digits = trimmed.replace(/[^\d+]/g, "");
  const rest = digits.startsWith("+") ? digits.slice(1).replace(/\D/g, "") : digits.replace(/\D/g, "");
  if (rest.length < 8 || rest.length > 15) return null;
  if (!/^[1-9]\d{7,14}$/.test(rest)) return null;
  // National-format numbers (US 10-digit, etc.) are not E.164 without a country code.
  if (!hadPlus && rest.length <= 10) return null;
  return `+${rest}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "••••";
  return `+${digits.slice(0, 2)}••••${digits.slice(-2)}`;
}

export function parseApiId(raw: string): number | null {
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1000 || n > 99_999_999) return null;
  return n;
}

export function parseApiHash(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(value)) return null;
  return value;
}
