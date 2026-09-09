import { formatMoney, isAmbiguousPriceProse, money, parseCurrency, parseMoneyFromText, type Money } from "./money.ts";

export type BusinessStatus = "draft" | "review" | "published" | "superseded" | "withdrawn";
export type OfferStatus = "draft" | "approved" | "published" | "unavailable";

export type ReviewQuestion = {
  id: string;
  excerpt: string;
  question: string;
};

export type DraftOffer = {
  serviceKey: string;
  title: string;
  amountMinor: number;
  currency: string;
  available: boolean;
  description: string;
};

export type BusinessOffer = {
  id: string;
  serviceKey: string;
  creatorId: string;
  bindingId: string;
  revisionId: string;
  title: string;
  amount: Money;
  available: boolean;
  status: OfferStatus;
  description: string;
};

export type StructuredBusiness = {
  displayName: string;
  about: string;
  voice: string;
  boundaries: string;
  offers: DraftOffer[];
  paymentCopy: string;
  destinationHint: string;
  reviewQuestions: ReviewQuestion[];
  sourceBrief: string;
};

export type BusinessRevision = {
  id: string;
  creatorId: string;
  bindingId: string;
  briefId: string;
  revision: number;
  status: BusinessStatus;
  isolated: boolean;
  structured: StructuredBusiness;
};

export type PublishedProjection = {
  revisionId: string;
  revision: number;
  creatorId: string;
  bindingId: string;
  displayName: string;
  about: string;
  isolated: boolean;
  offers: BusinessOffer[];
  paymentCopy: string;
  destinationHint: string;
  boundaries: string;
  voice: string;
};

const OFFER_TITLE = /^[\p{L}\p{N} ,.'&/-]{2,80}$/u;
const BRIEF_LIMIT = 8000;

export function serviceKeyFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return slug || "offer";
}

export function draftFromBrief(plain: string): StructuredBusiness {
  const text = plain.trim();
  if (!text) throw new Error("brief_required");
  if (text.length > BRIEF_LIMIT) throw new Error("brief_too_long");
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const displayName = (lines[0] ?? "Business").slice(0, 80);
  const rest = lines.slice(1).join(" ");
  const reviewQuestions: ReviewQuestion[] = [];
  const offers: DraftOffer[] = [];

  const moneyHits = parseMoneyFromText(text);
  const used = new Set<number>();
  for (const hit of moneyHits) {
    const windowStart = Math.max(0, hit.start - 80);
    const window = text.slice(windowStart, hit.end);
    const before = window.slice(0, window.length - hit.raw.length).replace(/[:\-–—,]+$/g, "").trim();
    const titleGuess = extractTitleNear(before, displayName);
    if (!OFFER_TITLE.test(titleGuess)) {
      reviewQuestions.push({
        id: `q_${offers.length + 1}`,
        excerpt: hit.raw,
        question: `Could not read a clear offer title next to ${hit.raw}. Name the service.`,
      });
      continue;
    }
    const key = serviceKeyFromTitle(titleGuess);
    if (used.has(hit.start)) continue;
    used.add(hit.start);
    offers.push({
      serviceKey: key,
      title: titleGuess,
      amountMinor: hit.money.minor,
      currency: hit.money.currency,
      available: true,
      description: "",
    });
  }

  if (isAmbiguousPriceProse(text)) {
    reviewQuestions.push({
      id: "q_ambiguous_price",
      excerpt: "around / about / roughly",
      question: "An approximate price is not publishable. Enter an exact amount and currency.",
    });
  }

  const paymentCopy = extractPaymentCopy(text);
  const destinationHint = extractDestination(text);
  const boundaries = extractBoundaries(text);
  const about = rest.slice(0, 2000) || displayName;
  const voice = extractVoice(text);

  return {
    displayName,
    about,
    voice,
    boundaries,
    offers,
    paymentCopy,
    destinationHint,
    reviewQuestions,
    sourceBrief: text,
  };
}

function extractTitleNear(before: string, fallback: string): string {
  const cleaned = before.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const parts = cleaned.split(/[.;\n]/).map((p) => p.trim()).filter(Boolean);
  const last = parts.at(-1) ?? cleaned;
  const words = last.split(/\s+/).filter(Boolean);
  const slice = words.slice(-8).join(" ").replace(/^(the|a|an)\s+/i, "");
  if (slice.length >= 2 && slice.length <= 80) return slice.slice(0, 80);
  return fallback.slice(0, 80);
}

function extractPaymentCopy(text: string): string {
  const lines = text.split(/\n+/);
  const hit = lines.find((l) => /\b(pay|cash app|venmo|paypal|stars|handle|send to)\b/i.test(l));
  return hit?.trim().slice(0, 400) ?? "";
}

function extractDestination(text: string): string {
  const cash = /\$[A-Za-z][A-Za-z0-9_]{2,24}/.exec(text);
  if (cash) return cash[0];
  const at = /@[A-Za-z][A-Za-z0-9_]{2,24}/.exec(text);
  if (at) return at[0];
  return "";
}

function extractBoundaries(text: string): string {
  const lines = text.split(/\n+/).filter((l) => /\b(no |do not |don't |never |must not )\b/i.test(l));
  return lines.join(" ").slice(0, 500);
}

function extractVoice(text: string): string {
  const line = text.split(/\n+/).find((l) => /^voice\s*:/i.test(l));
  return line ? line.replace(/^voice\s*:/i, "").trim().slice(0, 400) : "";
}

export function addOfferToDraft(
  draft: StructuredBusiness,
  input: { title: string; amountMinor: number; currency: string; available?: boolean; description?: string; serviceKey?: string },
): StructuredBusiness {
  const title = input.title.trim();
  if (!OFFER_TITLE.test(title)) throw new Error("offer_title_invalid");
  const currency = parseCurrency(input.currency);
  if (!currency) throw new Error("offer_currency_required");
  money(input.amountMinor, currency);
  const serviceKey = input.serviceKey?.trim() || serviceKeyFromTitle(title);
  return {
    ...draft,
    offers: [
      ...draft.offers.filter((o) => o.serviceKey !== serviceKey),
      {
        serviceKey,
        title,
        amountMinor: input.amountMinor,
        currency,
        available: input.available !== false,
        description: input.description?.trim() ?? "",
      },
    ],
  };
}

export function canPublish(draft: StructuredBusiness): { ok: true } | { ok: false; reason: string } {
  if (!draft.displayName.trim()) return { ok: false, reason: "display_name_required" };
  if (draft.offers.length === 0) return { ok: false, reason: "offer_required" };
  if (draft.reviewQuestions.length > 0) return { ok: false, reason: "unresolved_review_questions" };
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
    isolated: revision.isolated,
    offers: published,
    paymentCopy: revision.structured.paymentCopy,
    destinationHint: revision.structured.destinationHint,
    boundaries: revision.structured.boundaries,
    voice: revision.structured.voice,
  };
}

export function offerForGeneration(
  projection: PublishedProjection | null,
  offerId: string,
  creatorId: string,
): BusinessOffer | { error: string } {
  if (!projection) return { error: "no_published_revision" };
  if (projection.creatorId !== creatorId) return { error: "wrong_creator" };
  const offer =
    projection.offers.find((o) => o.id === offerId) ??
    projection.offers.find((o) => o.serviceKey === offerId);
  if (!offer) return { error: "offer_not_in_revision" };
  if (offer.creatorId !== creatorId) return { error: "wrong_creator" };
  if (!offer.available || offer.status === "unavailable") return { error: "offer_unavailable" };
  if (offer.status !== "published") return { error: "offer_not_published" };
  return offer;
}

export type PlanningRow = {
  id: string;
  sku: string;
  title: string;
  priceCents: number;
  currency: string;
  rail: string;
  available: boolean;
  eligibility: "any";
};

/** Planning uses this projection only. Empty means do not invent SKUs. */
export function planningCatalog(
  projection: PublishedProjection | null,
  paymentRail?: string | null,
): PlanningRow[] {
  if (!projection) return [];
  return projection.offers
    .filter((o) => o.available && o.status === "published")
    .map((o) => ({
      id: o.id,
      sku: o.serviceKey || o.id,
      title: o.title,
      priceCents: o.amount.minor,
      currency: o.amount.currency,
      rail: paymentRail?.trim() ? paymentRail.trim() : "",
      available: true,
      eligibility: "any" as const,
    }));
}

export function catalogLine(row: PlanningRow): string {
  const amount = formatMoney(money(row.priceCents, row.currency));
  const rail = row.rail?.trim() ? ` method=${row.rail}` : "";
  return `${row.sku} ${row.title} ${amount}${rail}`;
}
