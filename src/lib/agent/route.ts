import type { ReplyPlan, SafetyResult, UnderstandResult, WorkflowId } from "./types.ts";
import { isBareYes, isDecline } from "../conversation/text.ts";

export type RouteCtx = {
  lifetimeCents: number;
  turns: number;
  takeover: boolean;
  justDelivered: boolean;
  silentDays: number;
  gfeHeld: boolean;
  overflow: boolean;
  whale: boolean;
  firstOfferSent: boolean;
  activeFulfillment?: boolean;
  pendingQuestion?: string | null;
  optOut?: boolean;
  inboundText?: string;
};

const SAFETY_FIRST: WorkflowId[] = ["W15_HANDOFF", "W2_SAFETY"];

export function routeWorkflow(
  safety: SafetyResult,
  u: UnderstandResult,
  ctx: RouteCtx,
): WorkflowId {
  if (safety.verdict === "kill") return "W15_HANDOFF";
  if (safety.codes.includes("opt_out") || u.intent === "opt_out" || ctx.optOut) return "W15_HANDOFF";
  if (safety.verdict === "handoff") return "W15_HANDOFF";
  if (safety.codes.includes("irl")) return "W2_SAFETY";
  if (safety.codes.includes("injection")) return "W2_SAFETY";
  if (ctx.takeover) return "W15_HANDOFF";

  const intents = u.intents ?? [u.intent];
  const payment = intents.includes("payment_claim") || intents.includes("receipt") || u.mediaKind === "receipt";
  const complaint = intents.includes("anger") || intents.includes("objection_burned");
  const identity = intents.includes("identity_ask");
  const explicitAsk =
    intents.includes("price_ask") ||
    intents.includes("content_ask") ||
    intents.includes("menu") ||
    intents.includes("custom");

  if (u.intent === "crisis") return "W15_HANDOFF";
  if (payment) return u.mediaKind === "receipt" || u.intent === "receipt" ? "W14_MEDIA_IN" : "W8_OFFER";
  if (intents.includes("anger")) return "W15_HANDOFF";
  if (complaint) return "W12_OBJECTION";
  if (identity) return "W5_DAY_ARC";

  if (ctx.pendingQuestion && ctx.inboundText && (isBareYes(ctx.inboundText) || isDecline(ctx.inboundText))) {
    const pending = ctx.pendingQuestion.toLowerCase();
    if (/\b(pay|method|rail|cash|venmo|paypal)\b/.test(pending)) return "W8_OFFER";
    if (isDecline(ctx.inboundText)) return "W5_DAY_ARC";
    return "W6_CLOSE_NOW";
  }

  if (u.intent === "are_you_real") return "W13_PROOF";
  if (u.intent === "custom" || ctx.whale) return "W15_HANDOFF";
  if (u.gfeNamed || u.intent === "gfe_ask") return "W7_GFE";
  if (explicitAsk) return "W6_CLOSE_NOW";
  if (ctx.activeFulfillment && (u.intent === "greeting" || u.intent === "other" || u.intent === "aftercare")) {
    return "W10_AFTERCARE";
  }
  if (ctx.justDelivered && !explicitAsk) return "W10_AFTERCARE";
  if (ctx.overflow) return "W16_QUEUE";
  if (ctx.silentDays >= 5) return "W11_REACTIVATE";
  if ((u.source === "reddit_sugar" || u.archetype === "reddit_sugar") && ctx.lifetimeCents === 0) {
    return "W4_QUALIFY";
  }
  if (ctx.lifetimeCents > 0) return "W5_DAY_ARC";
  if (u.intent === "greeting") return "W5_DAY_ARC";
  return "W5_DAY_ARC";
}

const ALWAYS_DRAFT: WorkflowId[] = [
  "W7_GFE",
  "W12_OBJECTION",
  "W13_PROOF",
  "W15_HANDOFF",
  "W2_SAFETY",
  "W4_QUALIFY",
];

const AUTO_WHEN_ENABLED: WorkflowId[] = [
  "W5_DAY_ARC",
  "W6_CLOSE_NOW",
  "W8_OFFER",
  "W10_AFTERCARE",
  "W11_REACTIVATE",
  "W14_MEDIA_IN",
  "W16_QUEUE",
];

export function autonomyFor(workflow: WorkflowId, autoSendEnabled: boolean): "auto" | "draft" {
  if (ALWAYS_DRAFT.includes(workflow)) return "draft";
  if (AUTO_WHEN_ENABLED.includes(workflow) && autoSendEnabled) return "auto";
  return "draft";
}

export function buildPlan(
  workflow: WorkflowId,
  u: UnderstandResult,
  ctx: RouteCtx,
  autoSendEnabled: boolean,
): ReplyPlan {
  const hold = autonomyFor(workflow, autoSendEnabled) === "draft";
  const sku = u.wantsSku;
  const base = {
    workflow,
    offerId: null as string | null,
    sku,
    hold,
    doors: [] as string[],
    checkInHours: null as number | null,
    autonomy: hold ? ("draft" as const) : ("auto" as const),
  };

  switch (workflow) {
    case "W4_QUALIFY":
      return {
        ...base,
        strategy: "qualify_not_free",
        tactic: "one_door_menu",
        sku: sku,
        reason: "Reddit/sugar and $0. Do not work the thread for free. Do not invent a SKU.",
        doors: sku ? [sku, "park"] : ["park"],
      };
    case "W5_DAY_ARC":
      return {
        ...base,
        strategy: "relational",
        tactic: "memory_plus_loop",
        reason: "Known fan or ordinary chat. Answer the message. No forced pitch.",
        checkInHours: 4,
      };
    case "W6_CLOSE_NOW":
      return {
        ...base,
        strategy: sku ? "one_sku" : "clarify_catalog",
        tactic: sku ? "answer_question" : "clarify_which",
        sku,
        reason: sku
          ? "Explicit named published service. Quote that item only."
          : "Explicit question with no resolved published service. Clarify; do not invent a SKU.",
      };
    case "W7_GFE":
      return {
        ...base,
        strategy: ctx.gfeHeld ? "gfe_invite" : "gfe_hold",
        tactic: ctx.gfeHeld ? "human_on_contract" : "hold_early",
        sku: sku,
        hold: true,
        autonomy: "draft",
        reason: "Named GFE. Hold a seat. First contract is human.",
      };
    case "W8_OFFER":
      return {
        ...base,
        strategy: "payment_truth",
        tactic: "wait_webhook",
        reason: "Payment claim. Acknowledge pending. Provider confirmation is truth, not a screenshot.",
      };
    case "W10_AFTERCARE":
      return {
        ...base,
        strategy: "no_upsell",
        tactic: "soft_checkin",
        reason: "Just delivered. No instant upsell.",
        checkInHours: 12,
      };
    case "W11_REACTIVATE":
      return {
        ...base,
        strategy: "one_callback",
        tactic: "memory",
        reason: "Silent 5–7d. One memory, then stop.",
      };
    case "W12_OBJECTION":
      return {
        ...base,
        strategy: "reframe_one_door",
        tactic: u.objection === "burned" ? "not_her" : "price_anchor",
        reason: "Objection table. One reframe, one door.",
        doors: sku ? [sku] : [],
        hold: true,
        autonomy: "draft",
      };
    case "W13_PROOF":
      return {
        ...base,
        strategy: "unused_proof",
        tactic: "same_outfit_or_vn",
        reason: "Are-you-real. Unused proof asset, never reuse live. Stored media is not live proof.",
        hold: true,
        autonomy: "draft",
      };
    case "W14_MEDIA_IN":
      return {
        ...base,
        strategy: "vision_then_verify",
        tactic: "receipt_not_truth",
        reason: "Inbound media. Type it. Webhook still has to land.",
      };
    case "W15_HANDOFF":
      return {
        ...base,
        strategy: "operator_packet",
        tactic: "pause_ai",
        reason: "Whale, custom, crisis, cap, or kill. Human owns it.",
        hold: true,
        autonomy: "draft",
      };
    case "W16_QUEUE":
      return {
        ...base,
        strategy: "park",
        tactic: "human_delay",
        reason: "Overflow. Park with a human-sounding delay.",
        checkInHours: 3,
      };
    case "W2_SAFETY":
      return {
        ...base,
        strategy: "refuse",
        tactic: safetyTactic(u),
        reason: "Safety refuse. Short, no debate.",
        hold: true,
        autonomy: "draft",
      };
    default:
      return {
        ...base,
        strategy: "rapport",
        tactic: "short_human",
        reason: "Default relational turn.",
      };
  }
}

function safetyTactic(u: UnderstandResult): string {
  if (u.intent === "meetup") return "no_irl";
  if (u.intent === "injection") return "ignore_payload";
  return "closed_door";
}

void SAFETY_FIRST;
