/** Server-owned price card. The browser never supplies a price. */

export const FOLLOW_DISCOUNT_CENTS = 500;
export const MIN_INVOICE_CENTS = 2900;
export const MIN_INVOICE_WITH_FOLLOW_CENTS = 2400;
export const LOYALTY_CYCLES = 3;
export const LOYALTY_REFILL_BONUS = 0.15;
export const PERSONA_UNLOCK_CENTS = 50_000;
export const TOPUP_THREADS = 250;
export const TOPUP_PRICE_CENTS = 2900;

/** Single rail. CryptoBot is gone — US desks pay on the website. */
export type Rail = "plisio";
export type SkuKind = "pack" | "topup" | "refill";

export type CatalogSku = {
  id: string;
  kind: SkuKind;
  label: string;
  threads: number;
  priceCents: number;
  personas: number;
};

export const PACKS: readonly CatalogSku[] = [
  { id: "pack:starter", kind: "pack", label: "Starter", threads: 250, priceCents: 2900, personas: 0 },
  { id: "pack:solo", kind: "pack", label: "Solo", threads: 1000, priceCents: 7900, personas: 0 },
  { id: "pack:agency", kind: "pack", label: "Agency", threads: 4000, priceCents: 24900, personas: 0 },
  { id: "pack:volume", kind: "pack", label: "Volume", threads: 15000, priceCents: 79900, personas: 0 },
];

export const TOPUP: CatalogSku = {
  id: "topup",
  kind: "topup",
  label: "Top-up",
  threads: TOPUP_THREADS,
  priceCents: TOPUP_PRICE_CENTS,
  personas: 0,
};

export const PLANS: readonly CatalogSku[] = [
  { id: "plan:starter", kind: "refill", label: "Starter", threads: 400, priceCents: 3900, personas: 1 },
  { id: "plan:operator", kind: "refill", label: "Operator", threads: 1000, priceCents: 7900, personas: 3 },
  { id: "plan:desk", kind: "refill", label: "Desk", threads: 3000, priceCents: 17900, personas: 8 },
];

const BY_ID = new Map<string, CatalogSku>(
  [...PACKS, TOPUP, ...PLANS].map((s) => [s.id, s]),
);

export function skuById(id: string): CatalogSku | null {
  return BY_ID.get(id) ?? null;
}

export function pickRail(_priceCents?: number): Rail {
  return "plisio";
}

/** Quantity-first: snap to a defined pack, else N × 250 top-ups. Never a custom unit price. */
export function skuForThreads(threads: number): { sku: CatalogSku; multiples: number } | null {
  const n = Math.floor(threads);
  if (!Number.isFinite(n) || n < TOPUP_THREADS) return null;
  const pack = PACKS.find((p) => p.threads === n);
  if (pack) return { sku: pack, multiples: 1 };
  if (n % TOPUP_THREADS === 0) {
    return { sku: TOPUP, multiples: n / TOPUP_THREADS };
  }
  return null;
}

export type QuoteInput = {
  skuId: string;
  multiples?: number;
  firstPayment: boolean;
  followsVerified: boolean;
  discountAlreadyUsed: boolean;
  paidCycles?: number;
  lifetimeCents?: number;
};

export type Quote = {
  sku: CatalogSku;
  multiples: number;
  threads: number;
  amountCents: number;
  discountCents: number;
  rail: Rail;
  personasCap: number;
  followDiscountApplied: boolean;
};

export function followDiscountEligible(input: {
  firstPayment: boolean;
  followsVerified: boolean;
  discountAlreadyUsed: boolean;
}): boolean {
  return input.firstPayment && input.followsVerified && !input.discountAlreadyUsed;
}

export function quote(input: QuoteInput): Quote {
  const sku = skuById(input.skuId);
  if (!sku) throw new Error("Unknown pack.");
  const multiples = Math.max(1, Math.floor(input.multiples ?? 1));
  if (sku.kind !== "topup" && multiples !== 1) throw new Error("Unknown pack.");

  const discount =
    followDiscountEligible(input) && sku.priceCents * multiples >= MIN_INVOICE_CENTS
      ? FOLLOW_DISCOUNT_CENTS
      : 0;

  let threads = sku.threads * multiples;
  if (sku.kind === "refill" && (input.paidCycles ?? 0) >= LOYALTY_CYCLES) {
    threads = Math.floor(threads * (1 + LOYALTY_REFILL_BONUS));
  }

  const amountCents = sku.priceCents * multiples - discount;
  const min = discount > 0 ? MIN_INVOICE_WITH_FOLLOW_CENTS : MIN_INVOICE_CENTS;
  if (amountCents < min) throw new Error("Minimum invoice is $29.");

  let personasCap = sku.personas;
  if ((input.lifetimeCents ?? 0) + amountCents >= PERSONA_UNLOCK_CENTS && personasCap > 0) {
    personasCap += 1;
  }

  return {
    sku,
    multiples,
    threads,
    amountCents,
    discountCents: discount,
    rail: pickRail(sku.priceCents * multiples),
    personasCap,
    followDiscountApplied: discount > 0,
  };
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
