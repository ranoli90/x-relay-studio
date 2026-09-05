import type { CatalogRow } from "./types.ts";

const PRICE = /\$\s*(\d+(?:\.\d{1,2})?)/g;

export function allowedPrices(catalog: CatalogRow[]): Set<number> {
  return new Set(catalog.filter((r) => r.priceCents > 0).map((r) => Math.round(r.priceCents / 100)));
}

export function findSku(catalog: CatalogRow[], sku: string | null | undefined): CatalogRow | null {
  if (!sku) return null;
  return catalog.find((r) => r.sku === sku) ?? null;
}

export function inventedPrice(text: string, catalog: CatalogRow[]): number | null {
  const allow = allowedPrices(catalog);
  const re = new RegExp(PRICE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const dollars = Number(m[1]);
    if (!Number.isFinite(dollars)) continue;
    if (!allow.has(Math.round(dollars))) return dollars;
  }
  return null;
}

export function formatUsd(cents: number): string {
  if (cents <= 0) return "$0";
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}

export const DEFAULT_CATALOG: CatalogRow[] = [
  {
    id: "sku_dropbox",
    sku: "premade_dropbox",
    title: "Premade dropbox",
    priceCents: 8000,
    rail: "throne",
    eligibility: "any",
  },
  {
    id: "sku_sexting",
    sku: "sexting_session",
    title: "Sexting",
    priceCents: 6000,
    rail: "throne",
    eligibility: "any",
  },
  {
    id: "sku_call",
    sku: "video_call",
    title: "Video call",
    priceCents: 12000,
    rail: "throne",
    eligibility: "any",
  },
  {
    id: "sku_clip",
    sku: "custom_clip",
    title: "Custom",
    priceCents: 8000,
    rail: "throne",
    eligibility: "any",
  },
  {
    id: "sku_gfe_week",
    sku: "gfe_week",
    title: "Weekly GFE",
    priceCents: 15000,
    rail: "throne",
    eligibility: "gfe",
  },
];

export const RETIRED_SKUS = ["polaroid_set", "voice_note", "gfe_day"];
