/** Exact integer minor units plus an ISO currency. Never infer USD. */

export type Money = {
  minor: number;
  currency: string;
};

const CURRENCY = /^[A-Z]{3}$/;

export function parseCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return CURRENCY.test(c) ? c : null;
}

export function money(minor: number, currency: string): Money {
  if (!Number.isInteger(minor) || minor < 0) {
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
  return money(Math.round(amount * 100), currency);
}

export function formatMoney(value: Money): string {
  const sign = value.currency === "USD" ? "$" : `${value.currency} `;
  if (value.minor % 100 === 0) return `${sign}${value.minor / 100}`;
  return `${sign}${(value.minor / 100).toFixed(2)}`;
}

export function sameMoney(a: Money, b: Money): boolean {
  return a.minor === b.minor && a.currency === b.currency;
}
