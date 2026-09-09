import { formatMoney, parseCurrency, type Money } from "./money.ts";

export type QuoteSnapshot = {
  id?: string;
  sku: string;
  title: string;
  amount: Money;
  destinationId: string | null;
  businessRevision: number;
  customerId: string;
};

export type QuoteView = {
  id: string;
  sku: string;
  title: string;
  amountLabel: string;
  currency: string;
  destinationId: string | null;
  businessRevision: number;
};

export function quoteView(snapshot: QuoteSnapshot, id: string): QuoteView {
  return {
    id,
    sku: snapshot.sku,
    title: snapshot.title,
    amountLabel: formatMoney(snapshot.amount),
    currency: snapshot.amount.currency,
    destinationId: snapshot.destinationId,
    businessRevision: snapshot.businessRevision,
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
