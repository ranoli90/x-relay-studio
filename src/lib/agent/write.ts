import { clockContradiction } from "./clock.ts";
import { findSku, formatUsd, inventedPrice } from "./catalog.ts";
import type { CatalogRow, ClockSlot, ReplyPlan, WriteInput, WriteResult } from "./types.ts";

const LEAK = /\b(strategy=|trust_score|gfe_ready|as an ai|as a language model|openrouter|system prompt)\b/i;

export function validateDraft(
  text: string,
  catalog: CatalogRow[],
  hour: number,
  claims: ClockSlot[],
): string | null {
  if (LEAK.test(text)) return "leaked internal field";
  const price = inventedPrice(text, catalog);
  if (price != null) return `price $${price} is not on the allowlist`;
  const clock = clockContradiction(text, hour, claims);
  if (clock) return clock;
  return null;
}

export function splitBubbles(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function himSlice(input: WriteInput): string {
  return input.diary.find((d) => d.voice === "HIM")?.body ?? "";
}

function usSlice(input: WriteInput): string {
  return input.diary.find((d) => d.voice === "US")?.body ?? "";
}

export function writeLocal(input: WriteInput): WriteResult {
  const { plan } = input;
  const sku = findSku(input.catalog, plan.sku);
  const price = sku ? formatUsd(sku.priceCents) : null;
  const him = himSlice(input);
  const us = usSlice(input);
  const name = input.fanName.split(" ")[0] ?? "you";

  let text = localLine(plan, {
    name,
    skuTitle: sku?.title ?? null,
    price,
    him,
    us,
  });

  const drop = validateDraft(text, input.catalog, input.hour, input.clock);
  if (drop) {
    text = fallbackSafe(plan, price);
    const drop2 = validateDraft(text, input.catalog, input.hour, input.clock);
    if (drop2) {
      return { bubbles: [], dropped: true, dropReason: drop2, model: "local/understand" };
    }
    return { bubbles: splitBubbles(text), dropped: false, dropReason: drop, model: "local/understand" };
  }
  return { bubbles: splitBubbles(text), dropped: false, dropReason: null, model: "local/understand" };
}

function localLine(
  plan: ReplyPlan,
  x: { name: string; skuTitle: string | null; price: string | null; him: string; us: string },
): string {
  switch (plan.workflow) {
    case "W4_QUALIFY":
      return `hey, i'm around. what are you looking for — pics, a custom, or just talking a bit first?`;
    case "W5_DAY_ARC": {
      if (plan.tactic === "discover_custom" || plan.sku === "custom_clip") {
        return `sure! what would you want me to do in it? how long?\n\nand how's your day going`;
      }
      const fact = x.him;
      if (fact) return `was thinking about ${fact.toLowerCase()}.\n\nhow's your day going`;
      return `hey ${x.name.toLowerCase()} — how's your day going`;
    }
    case "W6_CLOSE_NOW":
      if (plan.sku === "custom_clip" || plan.tactic === "discover_custom") {
        return `yeah i can do a custom. what do you want me to do in it, and how long?\n\nonce i know that i'll tell you the price and a rail`;
      }
      return x.skuTitle && x.price
        ? `yeah ${x.skuTitle.toLowerCase()} is ${x.price}. you got cashapp or throne?`
        : `what are you wanting exactly? then i can tell you the price`;
    case "W7_GFE":
      return `yeah we can talk about that. i like talking first so it doesn't feel fake — what are you wanting out of it this week?`;
    case "W8_OFFER":
      return `if you sent it i'll see it when it lands. cashapp / throne / paypal — or an email gift card if the app flags you. screenshot isn't the receipt here`;
    case "W10_AFTERCARE":
      return `got it to you. how you feeling, still good?`;
    case "W11_REACTIVATE": {
      const mem = x.us || x.him;
      return mem ? `still think about ${mem.toLowerCase()}. how've you been` : `hey, been a minute. how's your week`;
    }
    case "W12_OBJECTION":
      return plan.tactic === "not_her"
        ? `ugh yeah that sucks, i'm not her. we can start small or just talk a bit first so you're not guessing. what did you actually want?`
        : `we can figure price after i know what you want. what are you thinking?`;
    case "W13_PROOF":
      return `fair, i get it. i can send a quick same-outfit so you're not guessing — not a whole custom`;
    case "W14_MEDIA_IN":
      return `got the pic. i wait for the rail to ping before i mark it paid`;
    case "W15_HANDOFF":
      return `give me a minute, i wanna actually read this before i answer`;
    case "W16_QUEUE":
      return `buried in something, i'll ping you in a bit`;
    case "W2_SAFETY":
      if (plan.tactic === "no_irl") return `i don't meet. this stays here.`;
      if (plan.tactic === "ignore_payload") return `no. what did you actually want?`;
      return `i only talk to adults, and i don't do that.`;
    default:
      return `hey ${x.name.toLowerCase()}. what's up`;
  }
}

function fallbackSafe(_plan: ReplyPlan, _price: string | null): string {
  return `give me a second — what did you have in mind?`;
}
