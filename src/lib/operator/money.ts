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

const AMOUNT_TOKEN = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,3})?|\d+[.,]\d{1,3}|\d+`;

/**
 * Extract explicit money mentions. Ambiguous prose ("around twenty") is not a hit.
 * Supports $12.50, $1,250, $1,250.00, 12.50 USD, USD 12.50, €12,50, EUR 1.250,00, KWD 1.251.
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

  const reSymbol = new RegExp(`([$€£¥])\\s*(${AMOUNT_TOKEN})`, "g");
  let m: RegExpExecArray | null;
  while ((m = reSymbol.exec(text))) {
    const currency = SYMBOL[m[1]!] ?? null;
    if (!currency) continue;
    const parsed = parseNumericToken(m[2]!, currency);
    if (parsed == null) continue;
    try {
      push({
        money: money(parsed.minor, currency),
        raw: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
    } catch {
      /* skip invalid */
    }
  }

  const reCode = new RegExp(
    `\\b(?:(${AMOUNT_TOKEN})\\s*([A-Z]{3})|([A-Z]{3})\\s*(${AMOUNT_TOKEN}))\\b`,
    "g",
  );
  while ((m = reCode.exec(text))) {
    const amountRaw = m[1] ?? m[4];
    const code = m[2] ?? m[3];
    const currency = parseCurrency(code);
    if (!currency || amountRaw == null) continue;
    const parsed = parseNumericToken(amountRaw, currency);
    if (parsed == null) continue;
    try {
      push({
        money: money(parsed.minor, currency),
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

/** Parse a whole numeric token. Reject unsupported grouping or excess precision. */
export function parseNumericToken(raw: string, currency: string): { minor: number } | null {
  const exp = currencyExponent(currency);
  const token = raw.trim();
  if (!token || !/^[\d.,]+$/.test(token)) return null;
  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");
  let intDigits = "";
  let fracDigits = "";

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    const grouping = decimalAt === lastComma ? "." : ",";
    const decimal = decimalAt === lastComma ? "," : ".";
    const intRaw = token.slice(0, decimalAt);
    fracDigits = token.slice(decimalAt + 1);
    if (!isGrouped(intRaw, grouping)) return null;
    intDigits = intRaw.replace(/[.,]/g, "");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = token.split(sep);
    if (parts.length === 2 && parts[1]!.length > 0 && parts[1]!.length !== 3) {
      intDigits = parts[0]!;
      fracDigits = parts[1]!;
    } else if (parts.length === 2 && parts[1]!.length === 3) {
      if (exp === 3 && sep === ".") {
        intDigits = parts[0]!;
        fracDigits = parts[1]!;
      } else if (exp === 0 && sep === ".") {
        if (!isGrouped(token, ".")) return null;
        intDigits = parts.join("");
      } else if (sep === ",") {
        if (!isGrouped(token, ",")) return null;
        intDigits = parts.join("");
      } else {
        return null;
      }
    } else if (parts.length > 2) {
      if (!isGrouped(token, sep)) return null;
      intDigits = parts.join("");
    } else {
      intDigits = parts[0]!;
      fracDigits = parts[1] ?? "";
    }
  } else {
    intDigits = token;
  }

  if (!/^\d+$/.test(intDigits) || (fracDigits && !/^\d+$/.test(fracDigits))) return null;
  if (fracDigits.length > exp) return null;
  const whole = Number(intDigits);
  if (!Number.isSafeInteger(whole) || whole < 0) return null;
  const scale = 10 ** exp;
  const fracPadded = (fracDigits + "0".repeat(exp)).slice(0, exp);
  const frac = exp === 0 ? 0 : Number(fracPadded || "0");
  const minor = whole * scale + frac;
  if (!Number.isSafeInteger(minor)) return null;
  return { minor };
}

function isGrouped(raw: string, sep: string): boolean {
  const parts = raw.split(sep);
  if (parts.length < 2) return /^\d+$/.test(raw);
  if (!/^\d{1,3}$/.test(parts[0]!)) return false;
  return parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

export function isAmbiguousPriceProse(raw: string): boolean {
  return /\b(around|about|roughly|ish|or so|ish)\b.{0,12}\b(\d+|twenty|thirty|forty|fifty)\b/i.test(raw);
}
