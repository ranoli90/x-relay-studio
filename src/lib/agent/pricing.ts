import { findSku, formatUsd } from "./catalog.ts";
import type { CatalogRow } from "./types.ts";

/** Spoken custom starts at $25. Never quote a single photo at $80. */
export const CUSTOM_LADDER_CENTS = [2500, 4000, 6000, 8000] as const;

export type PriceOutcome = "paid" | "rejected" | "ghosted" | "unknown";

export type PriceState = {
  lastPaidCents: number;
  rejects: number;
  ghosts: number;
  lifetimeCents: number;
};

export function customSkuForCents(cents: number): string {
  if (cents <= 2500) return "custom_clip";
  if (cents <= 4000) return "custom_mid";
  if (cents <= 6000) return "custom_plus";
  return "custom_long";
}

export function quoteCustom(state: PriceState): { sku: string; cents: number; dollars: number } {
  let step = 0;
  for (let i = 0; i < CUSTOM_LADDER_CENTS.length; i++) {
    if (state.lastPaidCents >= CUSTOM_LADDER_CENTS[i]) step = i;
  }
  if (state.lastPaidCents > 0 && state.rejects === 0 && state.ghosts === 0) {
    step = Math.min(CUSTOM_LADDER_CENTS.length - 1, step + 1);
  }
  if (state.rejects >= 1 || state.ghosts >= 2) {
    step = Math.max(0, step - 1);
  }
  if (state.lastPaidCents === 0) step = 0;
  const cents = CUSTOM_LADDER_CENTS[step];
  return { sku: customSkuForCents(cents), cents, dollars: cents / 100 };
}

export function applyOutcome(state: PriceState, outcome: PriceOutcome, paidCents = 0): PriceState {
  if (outcome === "paid") {
    return {
      lastPaidCents: Math.max(state.lastPaidCents, paidCents),
      rejects: 0,
      ghosts: 0,
      lifetimeCents: state.lifetimeCents + paidCents,
    };
  }
  if (outcome === "rejected") {
    return { ...state, rejects: state.rejects + 1 };
  }
  if (outcome === "ghosted") {
    return { ...state, ghosts: state.ghosts + 1 };
  }
  return state;
}

export function spokenCustomLine(catalog: CatalogRow[], state: PriceState): string {
  const q = quoteCustom(state);
  const row = findSku(catalog, q.sku);
  const price = row ? formatUsd(row.priceCents) : formatUsd(q.cents);
  return `a custom is ${price}`;
}

export function neverPhotoEighty(text: string): boolean {
  return /\b(photo|pic|picture|polaroid)\b.{0,20}\$\s*80\b/i.test(text);
}
