import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateDraft, writeLocal } from "./write.ts";
import { DEFAULT_CATALOG } from "./catalog.ts";
import type { ReplyPlan, WriteInput } from "./types.ts";

function plan(workflow: ReplyPlan["workflow"], extra: Partial<ReplyPlan> = {}): ReplyPlan {
  return {
    workflow,
    strategy: "test",
    tactic: extra.tactic ?? "ask",
    offerId: null,
    sku: extra.sku ?? "polaroid_set",
    hold: true,
    reason: "test",
    doors: [],
    checkInHours: null,
    autonomy: "draft",
  };
}

function input(workflow: ReplyPlan["workflow"], extra: Partial<WriteInput> = {}): WriteInput {
  return {
    plan: plan(workflow, extra.plan),
    personaName: "Maya",
    bible: "test",
    clock: [],
    hour: 18,
    diary: extra.diary ?? [],
    last: [],
    catalog: extra.catalog ?? DEFAULT_CATALOG,
    fanName: "Alex Buyer",
    inbound: "hi",
    proofAvailable: extra.proofAvailable,
    deliveryConfirmed: extra.deliveryConfirmed,
    ...extra,
  };
}

describe("D04 local writer claims", () => {
  it("does not invent gift-card or restriction workarounds", () => {
    const out = writeLocal(input("W8_OFFER"));
    const text = out.bubbles.join(" ").toLowerCase();
    assert.equal(out.dropped, false);
    assert.equal(/gift card|if the app flags|paypal/.test(text), false);
    assert.match(text, /screenshot isn't the receipt|listed rail/i);
  });

  it("names only catalog rails on a priced close", () => {
    const out = writeLocal(input("W6_CLOSE_NOW", { plan: plan("W6_CLOSE_NOW", { sku: "polaroid_set" }) }));
    const text = out.bubbles.join(" ").toLowerCase();
    assert.match(text, /stars/);
    assert.equal(/cashapp/.test(text), false);
  });

  it("does not promise proof when no asset is reserved", () => {
    const out = writeLocal(input("W13_PROOF", { proofAvailable: false }));
    const text = out.bubbles.join(" ").toLowerCase();
    assert.equal(/same-outfit|i can send a quick/.test(text), false);
    assert.match(text, /don't have a proof|not ready/i);
  });

  it("does not claim delivery without confirmation", () => {
    const out = writeLocal(input("W10_AFTERCARE", { deliveryConfirmed: false }));
    const text = out.bubbles.join(" ").toLowerCase();
    assert.equal(/got it to you/.test(text), false);
  });

  it("validateDraft rejects restriction-workaround copy", () => {
    const reason = validateDraft(
      "use an email gift card if the app flags you",
      DEFAULT_CATALOG,
      18,
      [],
    );
    assert.ok(reason);
  });
});
