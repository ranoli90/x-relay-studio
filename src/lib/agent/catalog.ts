import type { CatalogRow } from "./types.ts";
import { formatMoney, money, parseCurrency, parseMoneyFromText, currencyExponent } from "../operator/money.ts";

const PRICE = /\$\s*(\d+(?:\.\d{1,2})?)/g;

/** Rounded dollar set for display. Not a quote validator — use inventedPrice / inventedQuotedAmount with exact minor units. */
export function allowedPrices(catalog: CatalogRow[]): Set<number> {
  return new Set(catalog.filter((r) => r.priceCents > 0).map((r) => Math.round(r.priceCents / 100)));
}

export function findSku(catalog: CatalogRow[], sku: string | null | undefined): CatalogRow | null {
  if (!sku) return null;
  return catalog.find((r) => r.sku === sku) ?? catalog.find((r) => r.id === sku) ?? null;
}

function quotedCurrency(catalog: CatalogRow[], exactMinor?: number | null, exactCurrency?: string | null): string | null {
  const explicit = parseCurrency(exactCurrency);
  if (explicit) return explicit;
  if (typeof exactMinor === "number") {
    const row = catalog.find((r) => r.priceCents === exactMinor);
    return parseCurrency(row?.currency ?? catalog[0]?.currency ?? "USD");
  }
  return null;
}

export function inventedPrice(
  text: string,
  catalog: CatalogRow[],
  exactMinor?: number | null,
  exactCurrency?: string | null,
): number | null {
  const wantCurrency = quotedCurrency(catalog, exactMinor, exactCurrency);
  const hits = parseMoneyFromText(text);
  if (hits.length > 0) {
    for (const hit of hits) {
      const minor = hit.money.minor;
      const display = hit.money.minor / 10 ** currencyExponent(hit.money.currency);
      if (typeof exactMinor === "number") {
        if (minor !== exactMinor || (wantCurrency && hit.money.currency !== wantCurrency)) return display;
        continue;
      }
      const row = catalog.find((r) => r.priceCents === minor && (r.currency ?? "USD") === hit.money.currency);
      if (!row) return display;
    }
    return null;
  }
  const re = new RegExp(PRICE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const dollars = Number(m[1]);
    if (!Number.isFinite(dollars)) continue;
    const minor = Math.round(dollars * 100);
    if (typeof exactMinor === "number") {
      if (minor !== exactMinor || (wantCurrency && wantCurrency !== "USD")) return dollars;
      continue;
    }
    const row = catalog.find((r) => r.priceCents === minor && (r.currency ?? "USD") === "USD");
    if (!row) return dollars;
  }
  return null;
}

export function formatUsd(cents: number): string {
  return formatMoney(money(Math.max(0, Math.floor(cents)), "USD"));
}

/**
 * Isolated-fixture catalog only. Never insert these rows into a live desk.
 * Live commercial facts come exclusively from a published business revision.
 */
export const DEFAULT_CATALOG: CatalogRow[] = [
  { id: "sku_custom", sku: "custom_clip", title: "Custom", priceCents: 2500, rail: "throne", eligibility: "any", currency: "USD" },
  { id: "sku_custom_mid", sku: "custom_mid", title: "Custom", priceCents: 4000, rail: "throne", eligibility: "any", currency: "USD" },
  { id: "sku_custom_plus", sku: "custom_plus", title: "Custom", priceCents: 6000, rail: "throne", eligibility: "paid", currency: "USD" },
  { id: "sku_custom_long", sku: "custom_long", title: "Custom", priceCents: 8000, rail: "throne", eligibility: "paid", currency: "USD" },
  { id: "sku_sexting", sku: "sexting_session", title: "Sexting", priceCents: 6000, rail: "throne", eligibility: "any", currency: "USD" },
  { id: "sku_call", sku: "video_call", title: "Video call", priceCents: 12000, rail: "throne", eligibility: "any", currency: "USD" },
  { id: "sku_dropbox", sku: "premade_dropbox", title: "Premade dropbox", priceCents: 4000, rail: "throne", eligibility: "any", currency: "USD" },
  { id: "sku_gfe_week", sku: "gfe_week", title: "Weekly GFE", priceCents: 15000, rail: "throne", eligibility: "gfe", currency: "USD" },
];

export const FIXTURE_CATALOG = DEFAULT_CATALOG;

export const RETIRED_SKUS = ["polaroid_set", "voice_note", "gfe_day"];

export function liveSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  if (RETIRED_SKUS.includes(sku)) return null;
  return sku;
}
