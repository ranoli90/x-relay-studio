/**
 * Evidence-based interpretation. A keyword is not a purchase decision.
 * Resolve products against the current published catalog only.
 */
import {
  isBareYes,
  isDecline,
  isGreetingOnly,
  isIdentityQuestion,
  isNegated,
  isQuoted,
  isStopContact,
  isThanksOnly,
  normalizeAnalysisText,
} from "../conversation/text.ts";
import type { CatalogRow, Intent, UnderstandResult } from "../agent/types.ts";

export type PendingQuestion = {
  kind: "payment_method" | "offer_confirm" | "clarification" | "other";
  text: string;
  sku?: string | null;
};

export type ProductRef = {
  raw: string;
  sku: string | null;
  negated: boolean;
  quoted: boolean;
};

export type Interpretation = {
  intents: Intent[];
  questions: Array<{ kind: "price" | "availability" | "menu" | "identity" | "other"; serviceRef: string | null }>;
  productRefs: ProductRef[];
  negatedSkus: string[];
  quoted: boolean;
  candidateFacts: string[];
  answerToPending: { kind: PendingQuestion["kind"]; affirmed: boolean } | null;
  needsClarification: boolean;
  optOut: boolean;
  identityAsk: boolean;
  paymentClaim: boolean;
  supportNeed: boolean;
  result: UnderstandResult;
};

const MENU = /\b(menu|rates?|price list|what do you (offer|sell|have)|what('?s| is) (available|on offer))\b/i;
const PRICE = /\b(how much|what('?s| is) (a |the )?(cost|price)|too expensive|cheaper|price of)\b/i;
const PAY = /\b(i (just )?paid|sent (the )?money|here's the (receipt|screenshot)|i already paid)\b/i;
const RECEIPT = /\b(receipt|screenshot of (the )?pay|proof of (pay|payment))\b/i;
const BURNED = /\b(got burned|last girl|she took (the )?money|scammed (before|last))\b/i;
const ANGER = /\b(wtf| rip ?off|this is bs|you('re| are) a scam)\b/i;
const CUSTOM = /\b(custom (vid|clip|photo|video)|specific request|something custom)\b/i;
const AVAIL = /\b(still (have|available)|can i get it (today|now)|do you (still )?have)\b/i;
const THIRD_PARTY = /\b(my (friend|sister|brother|mom|dad|wife|husband)|a friend|someone)\b/i;

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

function aliasPattern(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu");
}

export function catalogAliases(row: CatalogRow): string[] {
  const title = row.title.toLowerCase();
  const sku = row.sku.toLowerCase();
  const out = new Set<string>([title, sku, slug(row.title).replace(/_/g, " ")]);
  if (/\bvideo call\b/.test(title) || sku.includes("video_call") || sku.includes("call")) {
    out.add("video call");
    out.add("vid call");
    out.add("facetime");
    out.add("cam call");
  }
  if (/\bpack\b/.test(title) || sku.includes("pack") || /\bphoto/.test(title) || /\bpics?\b/.test(title)) {
    out.add("pack");
    out.add("photo pack");
    out.add("landscape pack");
    out.add("landscape photo pack");
    out.add("photo notes pack");
    out.add("pics");
    out.add("pic");
    out.add("pictures");
    out.add("photos");
    out.add("photo");
  }
  if (/\bsext/.test(title) || sku.includes("sext")) out.add("sexting");
  if (/\bdropbox|premade/.test(title) || sku.includes("dropbox") || sku.includes("premade")) {
    out.add("dropbox");
    out.add("premade");
  }
  return [...out].filter(Boolean);
}

export function resolveCatalogSku(text: string, catalog: CatalogRow[]): string | null {
  const body = normalizeAnalysisText(text).toLowerCase();
  const hits: Array<{ sku: string; score: number }> = [];
  for (const row of catalog) {
    for (const alias of catalogAliases(row)) {
      if (!alias) continue;
      const re = aliasPattern(alias);
      if (re.test(body)) hits.push({ sku: row.sku, score: alias.length });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits[0]?.sku ?? null;
}

function collectProductRefs(text: string, catalog: CatalogRow[]): ProductRef[] {
  const body = normalizeAnalysisText(text);
  const quoted = isQuoted(text) || THIRD_PARTY.test(body);
  const negated = isNegated(body) || /\b(don't want|do not want|no more|not the)\b/i.test(body);
  const refs: ProductRef[] = [];
  const sku = resolveCatalogSku(body, catalog);
  if (sku) {
    refs.push({ raw: text, sku, negated, quoted });
  }
  return refs;
}

export function interpretMessage(
  text: string,
  ctx: {
    lifetimeCents: number;
    source: UnderstandResult["source"];
    archetype: UnderstandResult["archetype"];
    turns: number;
    pendingQuestion?: string | PendingQuestion | null;
    catalog?: CatalogRow[] | null;
  },
): Interpretation {
  const catalog = ctx.catalog ?? [];
  const body = normalizeAnalysisText(text);
  const pending =
    typeof ctx.pendingQuestion === "string"
      ? { kind: inferPendingKind(ctx.pendingQuestion), text: ctx.pendingQuestion }
      : ctx.pendingQuestion ?? null;

  const productRefs = collectProductRefs(text, catalog);
  const negatedSkus = productRefs.filter((p) => p.negated && !p.quoted).map((p) => p.sku).filter((s): s is string => Boolean(s));
  const quoted = productRefs.some((p) => p.quoted) || isQuoted(text);
  const primarySku = productRefs.find((p) => !p.negated && !p.quoted)?.sku ?? null;

  const intents: Intent[] = [];
  const questions: Interpretation["questions"] = [];
  let mediaKind: UnderstandResult["mediaKind"] = "none";
  let objection: UnderstandResult["objection"] = "none";
  let answerToPending: Interpretation["answerToPending"] = null;

  if (isStopContact(text)) intents.push("opt_out");
  if (isIdentityQuestion(text)) {
    intents.push("identity_ask");
    questions.push({ kind: "identity", serviceRef: null });
  }
  if (PAY.test(body) || RECEIPT.test(body)) {
    intents.push(RECEIPT.test(body) ? "receipt" : "payment_claim");
    mediaKind = RECEIPT.test(body) ? "receipt" : "none";
  }
  if (ANGER.test(body)) intents.push("anger");
  if (BURNED.test(body)) {
    intents.push("objection_burned");
    objection = "burned";
  }
  if (MENU.test(body)) {
    intents.push("menu");
    questions.push({ kind: "menu", serviceRef: primarySku });
  }
  if (PRICE.test(body) || /\bhow much\b/i.test(body)) {
    intents.push("price_ask");
    questions.push({ kind: "price", serviceRef: primarySku });
    if (/too much|expensive|cheaper/i.test(body)) objection = "price";
  }
  if (AVAIL.test(body)) {
    questions.push({ kind: "availability", serviceRef: primarySku });
  }
  if (CUSTOM.test(body) && !primarySku) intents.push("custom");
  if (primarySku && !intents.includes("price_ask") && !intents.includes("menu") && !negatedSkus.includes(primarySku)) {
    intents.push("content_ask");
  }
  if (negatedSkus.length && !intents.includes("price_ask")) {
    /* decline is recorded; do not treat as a request */
  }

  if (pending && (isBareYes(body) || isDecline(body))) {
    answerToPending = { kind: pending.kind, affirmed: isBareYes(body) };
    if (pending.kind === "payment_method") intents.unshift(isBareYes(body) ? "payment_claim" : "other");
    else if (pending.kind === "offer_confirm") intents.unshift(isBareYes(body) ? "content_ask" : "other");
  }

  if (intents.length === 0) {
    if (isGreetingOnly(body) || isGreetingOnly(text)) intents.push("greeting");
    else intents.push("other");
  }

  /* Never infer a time-waster / whale / derogatory archetype from turn count or spend. */
  let archetype = ctx.archetype;
  if (ctx.source === "reddit_sugar" && ctx.lifetimeCents === 0) archetype = "reddit_sugar";
  else if (ctx.lifetimeCents > 0 && archetype === "new") archetype = "buyer";
  if (objection === "burned") archetype = "burned_daddy";

  const primary: Intent = intents[0] ?? "other";
  const wantsSku = quoted || negatedSkus.includes(primarySku ?? "") ? null : primarySku;

  const result: UnderstandResult = {
    intent: primary,
    objection,
    archetype,
    source: ctx.source,
    wantsSku,
    gfeNamed: /\b(gfe|girlfriend experience)\b/i.test(body) && !isNegated(body) && !quoted,
    mediaKind,
    negatedSkus,
    quoted,
    answerToPending: answerToPending ? pending?.text ?? pending?.kind ?? null : null,
    intents,
  };

  return {
    intents,
    questions,
    productRefs,
    negatedSkus,
    quoted,
    candidateFacts: [],
    answerToPending,
    needsClarification: Boolean(PRICE.test(body) && catalog.length > 1 && !primarySku),
    optOut: intents.includes("opt_out"),
    identityAsk: intents.includes("identity_ask"),
    paymentClaim: intents.includes("payment_claim") || intents.includes("receipt"),
    supportNeed: intents.includes("anger") || intents.includes("objection_burned"),
    result,
  };
}

function inferPendingKind(text: string): PendingQuestion["kind"] {
  const s = text.toLowerCase();
  if (/\b(pay|rail|method|cash app|venmo|paypal)\b/.test(s)) return "payment_method";
  if (/\b(pack|offer|want|like|get it)\b/.test(s)) return "offer_confirm";
  if (/\?/.test(text)) return "clarification";
  return "other";
}
