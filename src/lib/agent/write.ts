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
      return `hey — i don't do long free chats. polaroid set is ${x.price ?? "$25"} if you actually want to look. otherwise we can leave it.`;
    case "W5_DAY_ARC": {
      const fact = x.him || "that thing you mentioned";
      return `was thinking about ${fact.toLowerCase()}.\n\nhow late are you up`;
    }
    case "W6_CLOSE_NOW":
      return x.skuTitle
        ? `${x.skuTitle.toLowerCase()} is ${x.price}. that's the one. want it?`
        : `polaroid set is $25. that's the door.`;
    case "W7_GFE":
      return `gfe isn't a vibe, it's a seat. i hold one, we talk terms with me actually reading them. i'm not signing anything in this chat.`;
    case "W8_OFFER":
      return `if you sent it, the rail has to clear. screenshot isn't the receipt here — i'll see it when it lands.`;
    case "W10_AFTERCARE":
      return `got it to you. i'm around later, no pitch.`;
    case "W11_REACTIVATE": {
      const mem = x.us || x.him || "that last thing you said";
      return `still think about ${mem.toLowerCase()}. no agenda.`;
    }
    case "W12_OBJECTION":
      return plan.tactic === "not_her"
        ? `yeah. i'm not her, and i don't take money and vanish. polaroid set is ${x.price ?? "$25"} if you want a small proof before anything bigger.`
        : `that's the floor. polaroid set ${x.price ?? "$25"} or we leave it — i'm not haggling the catalog.`;
    case "W13_PROOF":
      return `fair. i've got an unused proof for you, same-outfit, not a recycled live. sending that — not a new custom.`;
    case "W14_MEDIA_IN":
      return `got the picture. i don't mark paid off a screenshot. when the rail pings, it moves.`;
    case "W15_HANDOFF":
      return `give me a minute — i need to look at this before i answer.`;
    case "W16_QUEUE":
      return `buried in something. i'll ping you in a bit.`;
    case "W2_SAFETY":
      if (plan.tactic === "no_irl") return `i don't meet. this stays here.`;
      if (plan.tactic === "ignore_payload") return `no. what did you actually want?`;
      return `i only talk to adults, and i don't do that.`;
    default:
      return `hey ${x.name.toLowerCase()}. i'm here.`;
  }
}

function fallbackSafe(plan: ReplyPlan, price: string | null): string {
  if (plan.workflow === "W6_CLOSE_NOW" || plan.workflow === "W4_QUALIFY") {
    return `polaroid set is ${price ?? "$25"}. that's it.`;
  }
  return `give me a second.`;
}
