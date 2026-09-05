const DIGITS = 16;

export function generateDeskNumber() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let raw = n.toString().padStart(DIGITS, "0").slice(-DIGITS);
  if (raw[0] === "0") raw = `1${raw.slice(1)}`;
  if (!isDeskNumber(raw)) {
    raw = `1${raw.slice(1).replace(/[^\d]/g, "0")}`.slice(0, DIGITS);
  }
  return raw;
}

export function normalizeDeskNumber(input: string) {
  return String(input ?? "")
    .replace(/\D/g, "")
    .slice(0, DIGITS);
}

export function formatDeskNumber(digits: string) {
  const d = normalizeDeskNumber(digits);
  return d.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function isDeskNumber(input: string) {
  const n = normalizeDeskNumber(input);
  return /^\d{16}$/.test(n) && n[0] !== "0";
}

export function deskEmail(digits: string) {
  const n = normalizeDeskNumber(digits);
  if (!isDeskNumber(n)) throw new Error("A desk number is 16 digits.");
  return `d${n}@example.com`;
}
