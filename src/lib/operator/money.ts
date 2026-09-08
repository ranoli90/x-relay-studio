/** Exact integer minor units plus an ISO currency. Never infer USD. */

export type Money = {
  minor: number;
  currency: string;
};

const CURRENCY = /^[A-Z]{3}$/;

/** ISO-4217 exponents. Unknown codes default to 2. XTR (Telegram Stars) is 0. */
const EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  MXN: 2,
  BRL: 2,
  INR: 2,
  SGD: 2,
  HKD: 2,
  CNY: 2,
  JPY: 0,
  KRW: 0,
  VND: 0,
  XTR: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

export function parseCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return CURRENCY.test(c) ? c : null;
}

export function currencyExponent(currency: string): number {
  const c = parseCurrency(currency);
  if (!c) throw new Error("money_currency_required");
  return EXPONENTS[c] ?? 2;
}

export function money(minor: number, currency: string): Money {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error("money_minor_must_be_non_negative_integer");
  }
  const c = parseCurrency(currency);
  if (!c) throw new Error("money_currency_required");
  return { minor, currency: c };
}

export function moneyFromFractional(amount: number, currency: string): Money {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("money_amount_invalid");
  }
  const exp = currencyExponent(currency);
  const scale = 10 ** exp;
  return money(Math.round(amount * scale), currency);
}

export function formatMoney(value: Money): string {
  const exp = currencyExponent(value.currency);
  const scale = 10 ** exp;
  const whole = Math.floor(value.minor / scale);
  const frac = value.minor % scale;
  const sign = value.currency === "USD" ? "$" : value.currency === "EUR" ? "€" : `${value.currency} `;
  if (exp === 0 || frac === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(frac).padStart(exp, "0")}`;
}

export function minorToFractionalString(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const scale = 10 ** exp;
  const whole = Math.floor(minor / scale);
  const frac = minor % scale;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(exp, "0")}`;
}

export function sameMoney(a: Money, b: Money): boolean {
  return a.minor === b.minor && a.currency === b.currency;
}

export type ParsedMoneyHit = {
  money: Money;
  raw: string;
  start: number;
  end: number;
};

const SYMBOL: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};

/**
 * Extract explicit money mentions. Ambiguous prose ("around twenty") is not a hit.
 * Supports $12.50, 12.50 USD, USD 12.50, €12,50.
 */
export function parseMoneyFromText(raw: string): ParsedMoneyHit[] {
  const text = raw;
  const hits: ParsedMoneyHit[] = [];
  const seen = new Set<string>();
  const push = (hit: ParsedMoneyHit) => {
    const key = `${hit.start}:${hit.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  const reSymbol = /([$€£¥])\s*(\d{1,9}(?:[.,]\d{1,3})?)/g;
  let m: RegExpExecArray | null;
  while ((m = reSymbol.exec(text))) {
    const currency = SYMBOL[m[1]!] ?? null;
    if (!currency) continue;
    const amount = parseLooseAmount(m[2]!);
    if (amount == null) continue;
    try {
      push({
        money: moneyFromFractional(amount, currency),
        raw: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
    } catch {
      /* skip invalid */
    }
  }

  const reCode = /\b(?:(\d{1,9}(?:[.,]\d{1,3})?)\s*([A-Z]{3})|([A-Z]{3})\s*(\d{1,9}(?:[.,]\d{1,3})?))\b/g;
  while ((m = reCode.exec(text))) {
    const amountRaw = m[1] ?? m[4];
    const code = m[2] ?? m[3];
    const currency = parseCurrency(code);
    if (!currency || amountRaw == null) continue;
    const amount = parseLooseAmount(amountRaw);
    if (amount == null) continue;
    try {
      push({
        money: moneyFromFractional(amount, currency),
        raw: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
    } catch {
      /* skip */
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

function parseLooseAmount(raw: string): number | null {
  const normalized = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function isAmbiguousPriceProse(raw: string): boolean {
  return /\b(around|about|roughly|ish|or so|ish)\b.{0,12}\b(\d+|twenty|thirty|forty|fifty)\b/i.test(raw);
}
