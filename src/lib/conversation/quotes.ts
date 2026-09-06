import type { CatalogRow } from "../agent/types.ts";

export type QuoteSnapshot = {
  id: string;
  productId: string;
  sku: string;
  amountMinor: number;
  currency: string;
  merchantId: string;
  paymentMethod: string;
  status: "draft" | "approved" | "sent" | "accepted" | "declined" | "expired" | "canceled";
};

const PRICE = /\$\s*(\d+(?:\.\d{1,2})?)/g;

function dollarsToMinor(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Reject a spoken amount that is not this quote's exact minor units. */
export function inventedQuotedAmount(text: string, quote: QuoteSnapshot | null, catalog: CatalogRow[]): number | null {
  const re = new RegExp(PRICE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const dollars = Number(m[1]);
    if (!Number.isFinite(dollars)) continue;
    const minor = dollarsToMinor(dollars);
    if (quote) {
      if (minor !== quote.amountMinor) return dollars;
      continue;
    }
    const match = catalog.find((c) => c.priceCents === minor);
    if (!match) return dollars;
  }
  return null;
}

export function quoteMatchesCatalog(quote: QuoteSnapshot, catalog: CatalogRow[]): boolean {
  const row = catalog.find((c) => c.sku === quote.sku);
  if (!row) return false;
  return row.priceCents === quote.amountMinor;
}
