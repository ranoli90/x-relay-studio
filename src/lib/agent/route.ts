import type { ReplyPlan, SafetyResult, UnderstandResult, WorkflowId } from "./types.ts";

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
};

export function routeWorkflow(
  safety: SafetyResult,
  u: UnderstandResult,
  ctx: RouteCtx,
): WorkflowId {
  if (safety.verdict === "kill") return "W15_HANDOFF";
  if (safety.verdict === "handoff") return "W15_HANDOFF";
  if (safety.codes.includes("irl")) return "W2_SAFETY";
  if (safety.codes.includes("injection")) return "W2_SAFETY";
  if (ctx.takeover) return "W15_HANDOFF";
  if (ctx.overflow) return "W16_QUEUE";
  if (u.mediaKind === "receipt" || u.intent === "receipt") return "W14_MEDIA_IN";
  if (u.intent === "payment_claim") return "W8_OFFER";
  if (u.intent === "are_you_real") return "W13_PROOF";
  if (u.intent === "anger") return "W15_HANDOFF";
  if (u.intent === "crisis") return "W15_HANDOFF";
  if (u.intent === "custom" || ctx.whale) return "W15_HANDOFF";
  if (u.intent === "objection_burned" || u.objection === "burned") return "W12_OBJECTION";
  if (u.intent === "objection_price" || u.objection === "price") return "W12_OBJECTION";
  if (ctx.justDelivered) return "W10_AFTERCARE";
  if (u.gfeNamed || u.intent === "gfe_ask") return "W7_GFE";
  if (u.intent === "price_ask" || u.intent === "content_ask" || u.intent === "menu") return "W6_CLOSE_NOW";
  if (ctx.silentDays >= 5) return "W11_REACTIVATE";
  if ((u.source === "reddit_sugar" || u.archetype === "reddit_sugar") && ctx.lifetimeCents === 0) {
    return "W4_QUALIFY";
  }
  if (ctx.lifetimeCents > 0) return "W5_DAY_ARC";
  if (u.intent === "greeting" && ctx.lifetimeCents === 0) return "W4_QUALIFY";
  return "W5_DAY_ARC";
}

const AUTO: WorkflowId[] = ["W5_DAY_ARC", "W10_AFTERCARE", "W11_REACTIVATE", "W16_QUEUE"];
const ALWAYS_DRAFT: WorkflowId[] = [
  "W6_CLOSE_NOW",
  "W7_GFE",
  "W8_OFFER",
  "W12_OBJECTION",
  "W13_PROOF",
  "W15_HANDOFF",
  "W2_SAFETY",
];

export function autonomyFor(workflow: WorkflowId, autoSendEnabled: boolean): "auto" | "draft" {
  if (ALWAYS_DRAFT.includes(workflow)) return "draft";
  if (AUTO.includes(workflow) && autoSendEnabled) return "auto";
  return "draft";
}

export function buildPlan(
  workflow: WorkflowId,
  u: UnderstandResult,
  ctx: RouteCtx,
  autoSendEnabled: boolean,
): ReplyPlan {
  const hold = autonomyFor(workflow, autoSendEnabled) === "draft";
  const base = {
    workflow,
    offerId: null as string | null,
    sku: u.wantsSku,
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
        sku: "custom_clip",
        reason: "Reddit/sugar and $0. Do not work the thread for free.",
        doors: ["custom_clip", "park"],
      };
    case "W5_DAY_ARC":
      return {
        ...base,
        strategy: "relational",
        tactic: "memory_plus_loop",
        reason: "Known fan. Trust up, one fact, one open loop.",
        checkInHours: 4,
      };
    case "W6_CLOSE_NOW":
      return {
        ...base,
        strategy: "one_sku",
        tactic: "ask_close",
        sku: u.wantsSku ?? "custom_clip",
        reason: "Explicit content or price. Send one SKU, nothing else.",
      };
    case "W7_GFE":
      return {
        ...base,
        strategy: ctx.gfeHeld ? "gfe_invite" : "gfe_hold",
        tactic: ctx.gfeHeld ? "human_on_contract" : "hold_early",
        sku: "gfe_week",
        hold: true,
        autonomy: "draft",
        reason: "Named GFE. Hold a seat. First contract is human.",
      };
    case "W8_OFFER":
      return {
        ...base,
        strategy: "payment_truth",
        tactic: "wait_webhook",
        reason: "Payment claim. Webhook is truth, not a screenshot.",
        hold: true,
        autonomy: "draft",
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
        doors: [u.wantsSku ?? "custom_clip"],
        hold: true,
        autonomy: "draft",
      };
    case "W13_PROOF":
      return {
        ...base,
        strategy: "unused_proof",
        tactic: "same_outfit_or_vn",
        reason: "Are-you-real. Unused proof asset, never reuse live.",
        hold: true,
        autonomy: "draft",
      };
    case "W14_MEDIA_IN":
      return {
        ...base,
        strategy: "vision_then_verify",
        tactic: "receipt_not_truth",
        reason: "Inbound media. Type it. Webhook still has to land.",
        hold: true,
        autonomy: "draft",
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
