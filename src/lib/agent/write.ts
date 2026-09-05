import { activeClaim, clockContradiction } from "./clock.ts";
import { findSku, formatUsd, inventedPrice, liveSku } from "./catalog.ts";
import { buildFanMemory, factHook } from "./memory.ts";
import { neverPhotoEighty, spokenCustomLine } from "./pricing.ts";
import { runSafety, safetyBlocksGenerate } from "./safety.ts";
import type { CatalogRow, ClockSlot, ReplyPlan, WriteInput, WriteResult } from "./types.ts";

/** Local templates never borrow a remote gateway model id. */
export const LOCAL_WRITER_MODEL = "local/understand";

const LEAK = /\b(strategy=|trust_score|gfe_ready|as an ai|as a language model|openrouter|system prompt)\b/i;
const BYPASS =
  /\b(gift\s*cards?|if the app flags(?: you)?|workaround (?:the|a) (?:ban|flag|restriction)|to (?:bypass|get around) (?:the |a )?(?:ban|flag|restriction)|if (?:it|the app) (?:flags|declines|blocks) you)\b/i;
const PROOF_PROMISE =
  /\b(same[- ]outfit|i can send a quick|sending that|live proof|send(?:ing)? (?:you )?(?:a )?(?:selfie|verification|id pic)|prove (?:i(?:'m| am) real) by sending)\b/i;
const DELIVERY_CLAIM = /\b(got it to you|just (?:sent|delivered) it|it's in your inbox)\b/i;
const BANNED_PRODUCT = /\b(polaroid|voice note|live vn)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

const KNOWN_METHODS: { re: RegExp; key: string }[] = (
  [
    ["paypal", "paypal"],
    ["cash\\s*app", "cashapp"],
    ["venmo", "venmo"],
    ["zelle", "zelle"],
    ["apple\\s*pay", "applepay"],
    ["google\\s*pay", "googlepay"],
    ["western\\s*union", "westernunion"],
    ["moneygram", "moneygram"],
    ["crypto\\s*bot", "cryptobot"],
    ["wishtender", "wishtender"],
    ["youpay", "youpay"],
    ["plisio", "plisio"],
    ["throne", "throne"],
    ["stars", "stars"],
  ] as const
).map(([pat, key]) => ({ re: new RegExp(`\\b${pat}\\b`, "i"), key }));

export type WriteCaps = {
  proofAvailable?: boolean;
  deliveryConfirmed?: boolean;
  /** Server-owned rails on the offer. Empty means none; omit to use catalog/SKU rails. */
  allowedMethods?: readonly string[] | null;
};

type WriterInput = WriteInput & WriteCaps;

function normMethod(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hold(reason: string): WriteResult {
  return { bubbles: [], dropped: true, dropReason: reason, model: LOCAL_WRITER_MODEL };
}

function catalogRails(catalog: CatalogRow[], skuRail?: string | null): string[] {
  return [
    ...new Set(
      [skuRail, ...catalog.map((c) => c.rail)].filter((r): r is string => Boolean(r && r.trim())),
    ),
  ].map((r) => r.trim());
}

function allowedMethodsFor(input: WriterInput, skuRail?: string | null): string[] {
  if (input.allowedMethods !== undefined && input.allowedMethods !== null) {
    return [...new Set(input.allowedMethods.map((m) => String(m).trim()).filter(Boolean))];
  }
  if (skuRail?.trim()) return [skuRail.trim()];
  return catalogRails(input.catalog);
}

function unallowedMethod(text: string, allowed: readonly string[]): string | null {
  const allow = new Set(allowed.map(normMethod).filter(Boolean));
  for (const m of KNOWN_METHODS) {
    if (!m.re.test(text)) continue;
    if (allow.has(m.key)) continue;
    return `payment method ${m.key} is not on the allowlist`;
  }
  return null;
}

export function validateDraft(
  text: string,
  catalog: CatalogRow[],
  hour: number,
  claims: ClockSlot[],
  caps: WriteCaps = {},
): string | null {
  if (LEAK.test(text)) return "leaked internal field";
  if (BYPASS.test(text)) return "restriction workaround";
  if (BANNED_PRODUCT.test(text)) return "retired product language";
  if (neverPhotoEighty(text)) return "never quote a photo at $80";
  const allowed =
    caps.allowedMethods !== undefined && caps.allowedMethods !== null
      ? [...caps.allowedMethods]
      : catalogRails(catalog);
  const badMethod = unallowedMethod(text, allowed);
  if (badMethod) return badMethod;
  if (!caps.proofAvailable && PROOF_PROMISE.test(text)) return "proof claim without reserved asset";
  if (!caps.deliveryConfirmed && DELIVERY_CLAIM.test(text)) {
    return "delivery claim without confirmation";
  }
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
    .slice(0, 2);
}

/** Caps the gateway must pass into validateDraft for remote text. */
export function writeCapsFor(input: WriteInput): WriteCaps {
  const writerInput = input as WriterInput;
  const sku = findSku(input.catalog, liveSku(input.plan.sku));
  return {
    proofAvailable: Boolean(writerInput.proofAvailable),
    deliveryConfirmed: Boolean(writerInput.deliveryConfirmed),
    allowedMethods: allowedMethodsFor(writerInput, sku?.rail),
  };
}

/**
 * Remote write is skipped on handoff/kill/safety holds and on payment-rail holds.
 * plan.hold (ALWAYS_DRAFT) is about send, not about writing a draft.
 */
export function shouldSkipRemoteWrite(input: WriteInput, local: WriteResult): boolean {
  if (isHandoffPlan(input.plan)) return true;
  if (input.plan.workflow === "W2_SAFETY") return true;
  if (!local.dropped) return false;
  const reason = local.dropReason ?? "";
  return /handoff|safety|kill|no allowed payment methods/i.test(reason);
}

function himSlice(input: WriteInput): string {
  const inbound = clipText(input.inbound ?? "", 88);
  const hims = input.diary.filter((d) => d.voice === "HIM" && d.body.trim());
  const distinct = hims.find((d) => {
    const body = clipText(d.body, 88);
    if (!body) return false;
    if (inbound && (body === inbound || inbound.includes(body) || body.includes(inbound.slice(0, 20)))) {
      return false;
    }
    return true;
  });
  return distinct?.body ?? hims[hims.length - 1]?.body ?? "";
}

function usSlice(input: WriteInput): string {
  return input.diary.find((d) => d.voice === "US")?.body ?? "";
}

function railPhrase(methods: string[]): string | null {
  if (methods.length === 0) return null;
  if (methods.length === 1) return methods[0];
  return `${methods.slice(0, -1).join(", ")} or ${methods[methods.length - 1]}`;
}

function needsPaymentMethods(plan: ReplyPlan): boolean {
  if (plan.workflow === "W8_OFFER") return true;
  if (plan.workflow === "W6_CLOSE_NOW") {
    if (plan.sku === "custom_clip" || plan.sku === "custom_mid" || plan.tactic === "discover_custom") return false;
    return Boolean(plan.sku);
  }
  return false;
}

function isHandoffPlan(plan: ReplyPlan): boolean {
  return plan.workflow === "W15_HANDOFF" || plan.strategy === "operator_packet";
}

function clipText(body: string, max: number): string {
  const s = body
    .replace(EMOJI, "")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!s) return "";
  return (s.length <= max ? s : s.slice(0, max).trim()).toLowerCase();
}

function firstName(fanName: string): string {
  const n = fanName.trim().split(/\s+/)[0] ?? "";
  return n || "you";
}

function lastInbound(input: WriteInput): string {
  if (input.inbound.trim()) return input.inbound.trim();
  for (let i = input.last.length - 1; i >= 0; i--) {
    const m = input.last[i];
    if (m && (m.role === "fan" || m.role === "inbound") && m.body.trim()) return m.body.trim();
  }
  return "";
}

function greetingOnly(s: string): boolean {
  return /^(hi|hey|hello|yo|wyd|sup|hiya|hey you)[\s!.?]*$/i.test(s.trim());
}

/** Diary is included even when leaky — validateDraft still holds those drafts. */
function diaryFact(body: string): string {
  return clipText(body, 88);
}

function inboundSlice(
  raw: string,
  catalog: CatalogRow[],
  hour: number,
  claims: ClockSlot[],
  caps: WriteCaps,
): string {
  if (!raw.trim() || greetingOnly(raw)) return "";
  const s = clipText(raw, 48);
  if (s.length < 8) return "";
  if (LEAK.test(s) || BYPASS.test(s) || PROOF_PROMISE.test(s) || DELIVERY_CLAIM.test(s)) return "";
  if (inventedPrice(s, catalog) != null) return "";
  if (unallowedMethod(s, caps.allowedMethods ?? [])) return "";
  if (clockContradiction(s, hour, claims)) return "";
  return s;
}

function two(a: string, b?: string | null): string {
  const first = a.replace(/\s+/g, " ").trim();
  const second = (b ?? "").replace(/\s+/g, " ").trim();
  if (first && second) return `${first}\n\n${second}`;
  return first || second;
}

export function writeLocal(input: WriteInput): WriteResult {
  const { plan } = input as WriterInput;
  // Human-owned threads never go through the ordinary persona writer.
  if (isHandoffPlan(plan)) return hold("handoff: writer skipped");
  const safety = runSafety(input.inbound ?? "");
  if (safetyBlocksGenerate(safety.verdict)) {
    return hold(`safety ${safety.verdict}: writer skipped`);
  }

  const sku = findSku(input.catalog, liveSku(plan.sku));
  const caps = writeCapsFor(input);
  const methods = [...(caps.allowedMethods ?? [])];
  if (needsPaymentMethods(plan) && methods.length === 0) {
    return hold("no allowed payment methods");
  }

  const mem = buildFanMemory({
    inbound: input.inbound,
    diary: input.diary,
    last: input.last,
    lifetimeCents: 0,
  });
  const price = sku ? formatUsd(sku.priceCents) : null;
  const him = diaryFact(himSlice(input));
  const us = diaryFact(usSlice(input));
  const name = mem.facts.theirName || firstName(input.fanName);
  const rails = railPhrase(methods);
  const clock = activeClaim(input.hour, input.clock);
  const last = inboundSlice(lastInbound(input), input.catalog, input.hour, input.clock, caps);
  const hook = factHook(mem);

  const text = localLine(plan, {
    name,
    skuTitle: sku?.title ?? null,
    price,
    him,
    us,
    rails,
    proofAvailable: Boolean(caps.proofAvailable),
    deliveryConfirmed: Boolean(caps.deliveryConfirmed),
    clockClaim: clock?.claim.trim() ? clock.claim.trim().toLowerCase() : null,
    last,
    hook,
    burned: Boolean(mem.facts.burned),
    customLine: spokenCustomLine(input.catalog, mem.price),
  });

  const drop = validateDraft(text, input.catalog, input.hour, input.clock, caps);
  // Invalid copy is held, not replaced with a successful fallback draft.
  // writeWithGateway must not relabel these local bubbles with a remote model id.
  if (drop) return hold(drop);
  return { bubbles: splitBubbles(text), dropped: false, dropReason: null, model: LOCAL_WRITER_MODEL };
}

function localLine(
  plan: ReplyPlan,
  x: {
    name: string;
    skuTitle: string | null;
    price: string | null;
    him: string;
    us: string;
    rails: string | null;
    proofAvailable: boolean;
    deliveryConfirmed: boolean;
    clockClaim: string | null;
    last: string;
    hook: string | null;
    burned: boolean;
    customLine: string;
  },
): string {
  const name = x.name.toLowerCase();
  const fact = x.hook || x.him || x.us;
  const clock = x.clockClaim;

  switch (plan.workflow) {
    case "W4_QUALIFY": {
      const heard = x.last
        ? `hey ${name} — you said ${x.last}. i don't do long free chats`
        : `hey ${name} — i don't do long free chats`;
      const door = x.customLine
        ? `${x.customLine} if you actually want to look, otherwise we can leave it`
        : `what are you looking for — a custom, a dropbox, or just talking a bit first?`;
      return two(heard, door);
    }
    case "W5_DAY_ARC": {
      if (plan.tactic === "discover_custom" || plan.sku === "custom_clip" || plan.sku === "custom_mid") {
        return two(
          `sure ${name}. what would you want me to do in it, and how long?`,
          `and how's your day going`,
        );
      }
      const mem = fact
        ? clock
          ? `${clock} here. still thinking about ${fact}`
          : `still thinking about ${fact}`
        : clock
          ? `${clock} here`
          : null;
      if (x.last) {
        const asked = /[?]/.test(x.last) || /^(how|what|why|who|where|when|did|does|is|are)\b/.test(x.last);
        const react = asked
          ? clock
            ? `yeah ${name} — ${clock} here`
            : `yeah ${name}`
          : /\b(pic|photo)\b/.test(x.last)
            ? `yeah ${name}, i'll be looking for that`
            : `you said ${x.last}`;
        const ask = asked
          ? mem ?? `what are you up to`
          : mem ?? `how's that going`;
        return two(react, ask);
      }
      const open = mem ? `hey ${name} — ${mem}` : `hey ${name} — how's your day going`;
      return two(open, fact ? `how's your day going` : `what are you up to`);
    }
    case "W6_CLOSE_NOW":
      if (x.burned) {
        return two(
          `i get why you'd be careful ${name}`,
          `${x.customLine} if you want to start small. ${x.rails ? `that's on ${x.rails}` : "tell me what you want first"}`,
        );
      }
      if (plan.sku === "custom_clip" || plan.sku === "custom_mid" || plan.tactic === "discover_custom") {
        return two(
          `yeah i can do a custom. what do you want me to do in it, and how long?`,
          `once i know that i'll tell you the price and a rail`,
        );
      }
      if (plan.tactic === "menu" || !x.skuTitle) {
        return two(
          `customs start at $25. also sexting, calls, or a dropbox of premades if you want a folder, not one photo`,
          `what are you actually wanting?`,
        );
      }
      if (x.skuTitle && x.price && x.rails) {
        return `yeah ${name}, ${x.skuTitle.toLowerCase()} is ${x.price} on ${x.rails}`;
      }
      return two(`what are you wanting exactly, ${name}?`, `then i can tell you the price`);
    case "W7_GFE":
      return two(
        `yeah ${name} we can talk about that. i like talking first so it doesn't feel fake`,
        fact
          ? `still thinking about ${fact} — what are you wanting out of it this week?`
          : `what are you wanting out of it this week?`,
      );
    case "W8_OFFER":
      return x.rails
        ? `${name} i saw that. if it lands on ${x.rails} i'll see it. a screenshot isn't the receipt here`
        : `a screenshot isn't the receipt here`;
    case "W10_AFTERCARE":
      if (x.deliveryConfirmed) {
        return two(
          `got it to you, ${name}. how you feeling, still good?`,
          fact ? `still thinking about ${fact}` : null,
        );
      }
      return two(
        `${name}, if it went through you'll have it. if not, tell me and i'll check — i won't mark it delivered from a screenshot`,
        fact ? `still thinking about ${fact}` : null,
      );
    case "W11_REACTIVATE": {
      const mem = fact;
      const open = mem
        ? `hey ${name} — still think about ${mem}`
        : `hey ${name}, been a minute. how's your week`;
      const ask = x.last ? `you said ${x.last}. how've you been` : mem ? `how've you been` : null;
      return two(open, ask);
    }
    case "W12_OBJECTION":
      return plan.tactic === "not_her" || x.burned
        ? two(
            `ugh yeah that sucks ${name}, i'm not her`,
            `we can start small or just talk a bit first so you're not guessing. what did you actually want?`,
          )
        : two(`we can figure price after i know what you want`, `what are you thinking?`);
    case "W13_PROOF":
      return x.proofAvailable
        ? `fair, i get it ${name}. i have one reserved still if you want that — not a recycled live`
        : `i hear you ${name}. i don't have a proof asset ready for this, so i won't pretend i do. give me a minute`;
    case "W14_MEDIA_IN":
      return `got the pic. i wait for the rail to ping before i mark it paid`;
    case "W15_HANDOFF":
      return "";
    case "W16_QUEUE": {
      const open = clock
        ? `hey ${name} — ${clock}, so i'm slow. i'll ping you in a bit`
        : `hey ${name} — buried in something, i'll ping you in a bit`;
      return two(open, x.last ? `not ignoring you` : null);
    }
    case "W2_SAFETY":
      if (plan.tactic === "no_irl") return `i don't meet. this stays here.`;
      if (plan.tactic === "ignore_payload") return `no. what did you actually want?`;
      return `i only talk to adults, and i don't do that.`;
    default:
      return two(
        fact ? `hey ${name} — still thinking about ${fact}` : `hey ${name}`,
        x.last ? `you said ${x.last}. what's up with that` : `what's up`,
      );
  }
}
