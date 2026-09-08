import { money, parseCurrency, type Money } from "./money.ts";

export type BusinessStatus = "draft" | "review" | "published" | "superseded";
export type OfferStatus = "draft" | "approved" | "published" | "unavailable";

export type BusinessOffer = {
  id: string;
  creatorId: string;
  bindingId: string;
  revisionId: string;
  title: string;
  amount: Money;
  available: boolean;
  status: OfferStatus;
};

export type StructuredBusiness = {
  displayName: string;
  about: string;
  offers: Array<{
    title: string;
    amountMinor: number;
    currency: string;
    available: boolean;
  }>;
  paymentCopy: string;
};

export type BusinessRevision = {
  id: string;
  creatorId: string;
  bindingId: string;
  briefId: string;
  revision: number;
  status: BusinessStatus;
  structured: StructuredBusiness;
};

export type PublishedProjection = {
  revisionId: string;
  revision: number;
  creatorId: string;
  bindingId: string;
  displayName: string;
  about: string;
  offers: BusinessOffer[];
  paymentCopy: string;
};

const OFFER_TITLE = /^[\p{L}\p{N} ,.'&/-]{2,80}$/u;

export function draftFromBrief(plain: string): StructuredBusiness {
  const text = plain.trim();
  if (!text) throw new Error("brief_required");
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const displayName = (lines[0] ?? "Business").slice(0, 80);
  const about = lines.slice(1).join(" ").slice(0, 500) || displayName;
  return {
    displayName,
    about,
    offers: [],
    paymentCopy: "",
  };
}

export function addOfferToDraft(
  draft: StructuredBusiness,
  input: { title: string; amountMinor: number; currency: string; available?: boolean },
): StructuredBusiness {
  const title = input.title.trim();
  if (!OFFER_TITLE.test(title)) throw new Error("offer_title_invalid");
  const currency = parseCurrency(input.currency);
  if (!currency) throw new Error("offer_currency_required");
  money(input.amountMinor, currency);
  return {
    ...draft,
    offers: [
      ...draft.offers,
      {
        title,
        amountMinor: input.amountMinor,
        currency,
        available: input.available !== false,
      },
    ],
  };
}

export function canPublish(draft: StructuredBusiness): { ok: true } | { ok: false; reason: string } {
  if (!draft.displayName.trim()) return { ok: false, reason: "display_name_required" };
  if (draft.offers.length === 0) return { ok: false, reason: "offer_required" };
  for (const offer of draft.offers) {
    if (!parseCurrency(offer.currency)) return { ok: false, reason: "offer_currency_required" };
    if (!Number.isInteger(offer.amountMinor) || offer.amountMinor <= 0) {
      return { ok: false, reason: "offer_amount_invalid" };
    }
  }
  return { ok: true };
}

export function projectPublished(
  revision: BusinessRevision,
  offers: BusinessOffer[],
): PublishedProjection | null {
  if (revision.status !== "published") return null;
  const published = offers.filter(
    (o) => o.revisionId === revision.id && o.creatorId === revision.creatorId,
  );
  return {
    revisionId: revision.id,
    revision: revision.revision,
    creatorId: revision.creatorId,
    bindingId: revision.bindingId,
    displayName: revision.structured.displayName,
    about: revision.structured.about,
    offers: published,
    paymentCopy: revision.structured.paymentCopy,
  };
}

export function offerForGeneration(
  projection: PublishedProjection | null,
  offerId: string,
  creatorId: string,
): BusinessOffer | { error: string } {
  if (!projection) return { error: "no_published_revision" };
  if (projection.creatorId !== creatorId) return { error: "wrong_creator" };
  const offer = projection.offers.find((o) => o.id === offerId);
  if (!offer) return { error: "offer_not_in_revision" };
  if (offer.creatorId !== creatorId) return { error: "wrong_creator" };
  if (!offer.available || offer.status === "unavailable") return { error: "offer_unavailable" };
  if (offer.status !== "published") return { error: "offer_not_published" };
  return offer;
}

/** Planning uses this projection only. Empty means do not invent SKUs. */
export function planningCatalog(projection: PublishedProjection | null): Array<{
  id: string;
  sku: string;
  title: string;
  priceCents: number;
  currency: string;
  available: boolean;
}> {
  if (!projection) return [];
  return projection.offers
    .filter((o) => o.available && o.status === "published")
    .map((o) => ({
      id: o.id,
      sku: o.id,
      title: o.title,
      priceCents: o.amount.minor,
      currency: o.amount.currency,
      available: true,
    }));
}
