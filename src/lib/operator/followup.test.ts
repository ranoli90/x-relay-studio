import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMoney, money, moneyFromFractional, parseMoneyFromText } from "./money.ts";
import { interpretMessage, resolveCatalogSku } from "./interpret.ts";
import { inventedPrice } from "../agent/catalog.ts";
import { applyLiveArmSql } from "../agent/arm.ts";
import { routeWorkflow, buildPlan, autonomyFor } from "../agent/route.ts";
import { generationOriginForWrite, decideLiveAutoSend } from "../conversation/policy.ts";

const cat = [
  {
    id: "p",
    sku: "photo_notes_pack",
    title: "Photo notes pack",
    priceCents: 1250,
    currency: "USD",
    rail: "manual_handle",
    eligibility: "any",
  },
  {
    id: "c",
    sku: "video_call",
    title: "Video call",
    priceCents: 6000,
    currency: "USD",
    rail: "manual_handle",
    eligibility: "any",
  },
];
const base = { lifetimeCents: 0, source: "telegram" as const, archetype: "new" as const, turns: 1, catalog: cat };
const ctx = {
  lifetimeCents: 0,
  turns: 1,
  takeover: false,
  justDelivered: false,
  silentDays: 0,
  gfeHeld: false,
  overflow: false,
  whale: false,
  firstOfferSent: false,
};
const safe = { verdict: "allow" as const, codes: [] as string[], note: "" };
const auto = {
  personaAutoSend: true,
  goldAllowed: true,
  quiet: false,
  takeover: false,
  workflow: "W6_CLOSE_NOW" as const,
  dropped: false,
  killed: false,
  bubbleCount: 1,
  safetyVerdict: "allow" as const,
  emergencyStop: false,
  partnerOptOut: false,
  automationMode: "approved_auto" as const,
  generationOrigin: "validated_model" as const,
  adultEligibility: "allowed" as const,
  accountLive: true,
  conversationPermitted: true,
};

describe("follow-up target gates", () => {
  it("POS money formatting", () => {
    assert.equal(formatMoney(money(1250, "USD")), "$12.50");
    assert.equal(formatMoney(money(1250, "JPY")), "JPY 1250");
    assert.equal(formatMoney(money(1251, "KWD")), "KWD 1.251");
    assert.equal(moneyFromFractional(12.5, "USD").minor, 1250);
  });

  it("rejects cross-currency exact quotes", () => {
    assert.notEqual(inventedPrice("It costs €12.50", [cat[0]!], 1250), null);
    assert.notEqual(inventedPrice("It costs GBP 12.50", [cat[0]!], 1250), null);
    assert.notEqual(inventedPrice("It costs $12.50", [{ ...cat[0]!, currency: "JPY" }], 1250), null);
  });

  it("parses thousands grouping instead of a decimal comma", () => {
    assert.equal(parseMoneyFromText("$1,250")[0]?.money.minor, 125000);
    assert.equal(parseMoneyFromText("$1,250.00")[0]?.money.minor, 125000);
    assert.equal(parseMoneyFromText("USD 1,250.00")[0]?.money.minor, 125000);
    assert.equal(parseMoneyFromText("EUR 1.250,00")[0]?.money.minor, 125000);
    assert.equal(parseMoneyFromText("€12,50")[0]?.money.minor, 1250);
    assert.equal(parseMoneyFromText("KWD 1.251")[0]?.money.minor, 1251);
  });

  it("keeps clause-scoped product requests", () => {
    const mixed = interpretMessage("I don't want the photo pack; how much is the video call?", base);
    assert.equal(mixed.result.wantsSku, "video_call");
    assert.equal(interpretMessage("How much are the photo notes pack and the video call?", base).productRefs.length, 2);
    assert.equal(
      interpretMessage("My friend has the photo notes pack; I want a video call", base).result.wantsSku,
      "video_call",
    );
  });

  it("does not silently pick an ambiguous photo pack or a music pack from photos", () => {
    const twoPacks = [
      { ...cat[0]!, id: "urban", sku: "urban_pack", title: "Urban photo pack" },
      { ...cat[0]!, id: "nature", sku: "nature_pack", title: "Nature photo pack", priceCents: 2500 },
    ];
    assert.equal(resolveCatalogSku("pics", twoPacks), null);
    assert.equal(interpretMessage("how much for pics", { ...base, catalog: twoPacks }).result.wantsSku, null);
    assert.equal(interpretMessage("how much for pics", { ...base, catalog: twoPacks }).productRefs.length, 2);
    assert.equal(resolveCatalogSku("photos", [{ ...cat[0]!, sku: "music_pack", title: "Music pack" }]), null);

  });

  it("resolves pending yes/no without inventing a payment claim", () => {
    assert.equal(
      interpretMessage("yes", {
        ...base,
        pendingQuestion: { kind: "payment_method", text: "Can you use this payment method?" },
      }).paymentClaim,
      false,
    );
    assert.equal(
      interpretMessage("yes", {
        ...base,
        pendingQuestion: { kind: "offer_confirm", text: "Would you like this pack?", sku: "photo_notes_pack" },
      }).result.wantsSku,
      "photo_notes_pack",
    );
    const declined = interpretMessage("no thanks", { ...base, pendingQuestion: "Can you pay by this method?" });
    assert.equal(
      routeWorkflow(safe, declined.result, { ...ctx, pendingQuestion: "Can you pay by this method?", inboundText: "no thanks" }),
      "W5_DAY_ARC",
    );
  });

  it("plans a catalog menu for a direct menu question", () => {
    const menu = interpretMessage("What do you offer?", base);
    const menuPlan = buildPlan(routeWorkflow(safe, menu.result, ctx), menu.result, ctx, true);
    assert.notEqual(menuPlan.strategy, "clarify_catalog");
    assert.equal(menuPlan.strategy, "catalog_menu");
  });

  it("keeps local templates off auto-send and allows vetted notices", () => {
    const localOrigin = generationOriginForWrite({ dropped: false, model: "local/understand" });
    assert.equal(decideLiveAutoSend({ ...auto, generationOrigin: localOrigin }).reason, "origin_local_template");
    const notice = generationOriginForWrite({ dropped: false, model: "local/service-notice" });
    assert.equal(decideLiveAutoSend({ ...auto, generationOrigin: notice, workflow: "W5_DAY_ARC" }).send, true);
    assert.equal(generationOriginForWrite({ dropped: false, model: "local/service-notice-extra" }), "local_template");
    assert.equal(autonomyFor("W6_CLOSE_NOW", true), "auto");
  });

  it("arming SQL never assigns processing_permission = true", async () => {
    const sqlCalls: { text: string; params?: unknown[] }[] = [];
    await applyLiveArmSql("synthetic-user", {
      query: async (text, params) => {
        sqlCalls.push({ text, params });
        return [];
      },
    });
    const personaSql = sqlCalls.find((c) => c.text.includes("update agent_personas"))!.text;
    const setClause = personaSql.split("where")[0]!;
    const whereClause = personaSql.split("where")[1] ?? "";
    assert.equal(/processing_permission\s*=\s*true/.test(setClause) && !/processing_permission/.test(whereClause), false);
    assert.match(personaSql, /coalesce\(emergency_stop, false\) = false/);
  });

  it("quote views require the payable quote id", async () => {
    const { quoteFromOffer, quoteView } = await import("./quotes.ts");
    const snap = quoteFromOffer({
      sku: "photo_notes_pack",
      title: "Photo notes",
      amountMinor: 1250,
      currency: "USD",
      destinationId: "dest_1",
      businessRevision: 3,
      customerId: "c1",
    });
    assert.equal("error" in snap, false);
    if ("error" in snap) return;
    const view = quoteView(snap, "quo_live");
    assert.equal(view.id, "quo_live");
    assert.equal(view.destinationId, "dest_1");
    assert.equal(view.businessRevision, 3);
  });

  it("unknown eligibility holds standard auto-send", async () => {
    const { decideLiveAutoSend } = await import("../conversation/policy.ts");
    const held = decideLiveAutoSend({ ...auto, adultEligibility: "unknown" });
    assert.equal(held.send, false);
    assert.equal(held.reason, "adult_unknown");
    assert.equal(decideLiveAutoSend({ ...auto, adultEligibility: "allowed" }).send, true);
  });
});
