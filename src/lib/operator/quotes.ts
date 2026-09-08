import { formatMoney, parseCurrency, type Money } from "./money.ts";

export type QuoteSnapshot = {
  sku: string;
  title: string;
  amount: Money;
  destinationId: string | null;
  businessRevision: number;
  customerId: string;
};

export type QuoteView = {
  sku: string;
  title: string;
  amountLabel: string;
};

export function quoteView(snapshot: QuoteSnapshot): QuoteView {
  return {
    sku: snapshot.sku,
    title: snapshot.title,
    amountLabel: formatMoney(snapshot.amount),
  };
}

export function quoteFromOffer(input: {
  sku: string;
  title: string;
  amountMinor: number;
  currency: string;
  destinationId?: string | null;
  businessRevision: number;
  customerId: string;
}): QuoteSnapshot | { error: string } {
  const currency = parseCurrency(input.currency);
  if (!currency) return { error: "currency_missing" };
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    return { error: "amount_invalid" };
  }
  if (!input.sku.trim()) return { error: "sku_required" };
  return {
    sku: input.sku.trim(),
    title: input.title.trim(),
    amount: { minor: input.amountMinor, currency },
    destinationId: input.destinationId ?? null,
    businessRevision: input.businessRevision,
    customerId: input.customerId,
  };
}
