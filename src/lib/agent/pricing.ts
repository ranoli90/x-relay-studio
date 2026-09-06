import { findSku, formatUsd } from "./catalog.ts";
import type { CatalogRow } from "./types.ts";

/** Catalog custom_clip is $25. Ladder rungs below are operator-preview-only — not live quotes. */
export const CUSTOM_LADDER_CENTS = [2500, 4000, 6000, 8000] as const;

export type PriceOutcome = "paid" | "rejected" | "ghosted" | "unknown";

export type PriceState = {
  lastPaidCents: number;
  rejects: number;
  ghosts: number;
  lifetimeCents: number;
};

export type ApprovedCustomQuote = {
  sku: string;
  cents: number;
};

export function customSkuForCents(cents: number): string {
  if (cents <= 2500) return "custom_clip";
  if (cents <= 4000) return "custom_mid";
  if (cents <= 6000) return "custom_plus";
  return "custom_long";
}

/**
 * Live custom quote: catalog `custom_clip` (or an explicit operator-approved quote).
 * Ignores lastPaidCents / lifetimeCents. Not a settlement rule.
 */
export function quoteCustom(
  _state: PriceState,
  approved?: ApprovedCustomQuote | null,
): { sku: string; cents: number; dollars: number } {
  if (approved && Number.isInteger(approved.cents) && approved.cents > 0) {
    return { sku: approved.sku || "custom_clip", cents: approved.cents, dollars: approved.cents / 100 };
  }
  const cents = CUSTOM_LADDER_CENTS[0];
  return { sku: "custom_clip", cents, dollars: cents / 100 };
}

/**
 * Operator-preview-only. Climbs CUSTOM_LADDER_CENTS from lastPaidCents max.
 * Not wired to settlement. Must not be called from live writers.
 */
export function previewCustomLadder(state: PriceState): { sku: string; cents: number; dollars: number } {
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

/**
 * Operator-preview-only. lastPaidCents is a historical maximum, not a live SKU picker.
 * Not wired to settlement. Must not be called from live writers.
 */
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

/**
 * Live spoken custom: catalog `custom_clip` exact price only.
 * PriceState is ignored so guessed lastPaidCents / lifetime cannot climb a rung.
 * Missing SKU means unavailable — no hard-coded fallback quote.
 */
export function spokenCustomLine(catalog: CatalogRow[], _state?: PriceState): string {
  const row = findSku(catalog, "custom_clip");
  if (!row || row.priceCents <= 0) return "";
  return `a custom is ${formatUsd(row.priceCents)}`;
}

export function neverPhotoEighty(text: string): boolean {
  return /\b(photo|pic|picture|polaroid)\b.{0,20}\$\s*80\b/i.test(text);
}
