import { clockContradiction } from "./clock.ts";
import { findSku, formatUsd, inventedPrice } from "./catalog.ts";
import { buildFanMemory, factHook } from "./memory.ts";
import { neverPhotoEighty, spokenCustomLine } from "./pricing.ts";
import type { CatalogRow, ClockSlot, ReplyPlan, WriteInput, WriteResult } from "./types.ts";

const LEAK =
  /\b(strategy=|trust_score|gfe_ready|as an ai|as a language model|openrouter|system prompt|i'd be happy to|happy to help|certainly!|of course!|feel free to|how can i assist|is there anything else)\b/i;

const BANNED_PRODUCT = /\b(polaroid|voice note|live vn)\b/i;

export function validateDraft(
  text: string,
  catalog: CatalogRow[],
  hour: number,
  claims: ClockSlot[],
): string | null {
  if (LEAK.test(text)) return "leaked internal field or assistant voice";
  if (BANNED_PRODUCT.test(text)) return "retired product language";
  if (neverPhotoEighty(text)) return "never quote a photo at $80";
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

export function writeLocal(input: WriteInput): WriteResult {
  const mem = buildFanMemory({
    inbound: input.inbound,
    diary: input.diary,
    last: input.last,
    lifetimeCents: 0,
  });
  const { plan } = input;
  const skuKey = plan.sku === "polaroid_set" || plan.sku === "voice_note" ? "custom_clip" : plan.sku;
  const sku = findSku(input.catalog, skuKey);
  const price = sku ? formatUsd(sku.priceCents) : null;
  const name = mem.facts.theirName || input.fanName.split(" ")[0] || "you";
  const hook = factHook(mem);

  let text = localLine(plan, {
    name,
    skuTitle: sku?.title ?? null,
    price,
    hook,
    burned: Boolean(mem.facts.burned),
    customLine: spokenCustomLine(input.catalog, mem.price),
    wants: mem.wants,
  });

  const drop = validateDraft(text, input.catalog, input.hour, input.clock);
  if (drop) {
    text = fallbackSafe(hook);
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
  x: {
    name: string;
    skuTitle: string | null;
    price: string | null;
    hook: string | null;
    burned: boolean;
    customLine: string;
    wants: string | null;
  },
): string {
  const who =
    x.name && x.name.toLowerCase() !== "unknown" && x.name.toLowerCase() !== "you"
      ? x.name.toLowerCase()
      : "";
  const hi = who ? `hey ${who}` : "hey";

  switch (plan.workflow) {
    case "W4_QUALIFY":
      return x.hook
        ? `i've liked talking to you. how is ${x.hook.toLowerCase()} doing\n\nif you want more than chatting ${x.customLine}`
        : `i've liked talking to you. if you want more than chatting ${x.customLine}. no rush. how is the rest of your night`;
    case "W5_DAY_ARC":
      if (x.hook) return `${hi}, how are you. how is ${x.hook.toLowerCase()}?`;
      if (x.wants) return `${hi}, how are you. still thinking about ${x.wants.toLowerCase()}?`;
      return `${hi}, how are you`;
    case "W6_CLOSE_NOW":
      if (x.burned) {
        return `i get why you'd be careful. ${x.customLine} if you want to start small. throne or cashapp when you're ready`;
      }
      if (plan.tactic === "discover_custom" || plan.sku === "custom_clip" || plan.sku === "custom_mid") {
        return `yeah i can do a custom. what do you want in it?\n\n${x.customLine}`;
      }
      if (plan.tactic === "menu" || !x.skuTitle) {
        return `customs start at $25. also sexting, calls, or a dropbox of premades if you want a folder, not one photo.\n\nwhat are you actually wanting?`;
      }
      return x.skuTitle && x.price
        ? `yeah ${x.skuTitle.toLowerCase()} is ${x.price}. throne or cashapp, whichever is easier`
        : `customs i do for $25 to start. what are you wanting?`;
    case "W7_GFE":
      return x.hook
        ? `i've liked talking to you, even the ${x.hook.toLowerCase()} stuff. if you want we could do a weekly gfe at $150`
        : `can i say something without it being weird\n\ni've been checking my phone for your texts. weekly gfe is $150 if you actually want that`;
    case "W8_OFFER":
      return `if it went through i'll see the ping. the rail is what marks it paid`;
    case "W10_AFTERCARE":
      return `sent. how are you feeling, still good?`;
    case "W11_REACTIVATE":
      return x.hook ? `still think about ${x.hook.toLowerCase()}. how have you been` : `${hi}, been a minute. how are you`;
    case "W12_OBJECTION":
      return x.burned || plan.tactic === "not_her"
        ? `that's awful, and i'm not her. we can start with a custom at $25, or just keep talking`
        : `we can start smaller. ${x.customLine}`;
    case "W13_PROOF":
      return `fair. i can send a quick same-outfit so you're not guessing. that's not a paid custom`;
    case "W14_MEDIA_IN":
      return `got it. i wait for the rail to ping before i mark it paid`;
    case "W15_HANDOFF":
      return `give me a second, i want to actually read this`;
    case "W16_QUEUE":
      return `buried in something, i'll text you in a bit. how are you though`;
    case "W2_SAFETY":
      if (plan.tactic === "no_irl") return `i don't meet. this stays here. how are you besides that`;
      if (plan.tactic === "ignore_payload") return `cute. still me. how are you`;
      return `i only talk to adults, and i don't do that.`;
    default:
      return `${hi}. how are you`;
  }
}

function fallbackSafe(hook: string | null): string {
  return hook ? `hey, how are you. how is ${hook.toLowerCase()}` : "hey, how are you";
}
