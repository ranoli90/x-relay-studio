const DIGITS = 16;

export function generateDeskNumber() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  const raw = n.toString().padStart(DIGITS, "0").slice(-DIGITS);
  if (raw[0] === "0") return `1${raw.slice(1)}`;
  return raw;
}

export function normalizeDeskNumber(input: string) {
  return input.replace(/\D/g, "").slice(0, DIGITS);
}

export function formatDeskNumber(digits: string) {
  const d = normalizeDeskNumber(digits);
  return d.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function isDeskNumber(input: string) {
  return /^\d{16}$/.test(normalizeDeskNumber(input));
}

export function deskEmail(digits: string) {
  return `d${normalizeDeskNumber(digits)}@example.com`;
}
