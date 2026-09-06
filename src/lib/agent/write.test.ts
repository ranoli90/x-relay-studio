import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOCAL_WRITER_MODEL,
  shouldSkipRemoteWrite,
  validateDraft,
  writeCapsFor,
  writeLocal,
} from "./write.ts";
import { safetyBlocksGenerate } from "./safety.ts";
import { goldSummary } from "./eval.ts";
import { DEFAULT_CATALOG } from "./catalog.ts";
import type { GoldResult } from "./eval.ts";
import type { CatalogRow, ClockSlot, ReplyPlan, WriteInput } from "./types.ts";

function plan(workflow: ReplyPlan["workflow"], extra: Partial<ReplyPlan> = {}): ReplyPlan {
  return {
    workflow,
    strategy: extra.strategy ?? "test",
    tactic: extra.tactic ?? "ask",
    offerId: null,
    sku: extra.sku ?? null,
    hold: true,
    reason: extra.reason ?? "test",
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
    inbound: extra.inbound ?? "hi",
    proofAvailable: extra.proofAvailable,
    deliveryConfirmed: extra.deliveryConfirmed,
    ...extra,
  };
}

const NO_RAIL: CatalogRow[] = [
  {
    id: "sku_sext",
    sku: "sexting_session",
    title: "Sexting",
    priceCents: 6000,
    rail: "",
    eligibility: "any",
  },
];

const WAREHOUSE: ClockSlot[] = [
  { kind: "warehouse", claim: "on warehouse shift", startHour: 22, endHour: 6 },
];

describe("D04 local writer claims", () => {
  it("does not invent gift-card or restriction workarounds", () => {
    const out = writeLocal(input("W8_OFFER"));
    const text = out.bubbles.join(" ").toLowerCase();
    assert.equal(out.dropped, false);
    assert.equal(/gift card|if the app flags|paypal/.test(text), false);
    assert.match(text, /screenshot isn't the receipt|listed rail/i);
  });

  it("names only the offer sku rail on a priced close", () => {
    const out = writeLocal(input("W6_CLOSE_NOW", { plan: plan("W6_CLOSE_NOW", { sku: "sexting_session" }) }));
    const text = out.bubbles.join(" ").toLowerCase();
    assert.equal(out.dropped, false);
    assert.match(text, /throne/);
    assert.equal(/cashapp|paypal|venmo|gift card/.test(text), false);
    assert.equal(out.model, LOCAL_WRITER_MODEL);
  });

  it("holds a priced close when no allowed payment method is on the offer", () => {
    const out = writeLocal(
      input("W6_CLOSE_NOW", {
        catalog: NO_RAIL,
        plan: plan("W6_CLOSE_NOW", { sku: "sexting_session" }),
      }),
    );
    assert.equal(out.dropped, true);
    assert.equal(out.bubbles.length, 0);
    assert.match(out.dropReason ?? "", /no allowed payment methods/);
    assert.equal(out.model, LOCAL_WRITER_MODEL);
  });

  it("holds a payment-claim draft when catalog rails are missing", () => {
    const out = writeLocal(input("W8_OFFER", { catalog: [], plan: plan("W8_OFFER", { sku: null }) }));
    assert.equal(out.dropped, true);
    assert.equal(out.bubbles.length, 0);
    assert.match(out.dropReason ?? "", /no allowed payment methods/);
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

  it("validateDraft rejects unsupported payment methods not on the catalog", () => {
    const paypal = validateDraft("send it on paypal or cashapp", DEFAULT_CATALOG, 18, []);
    assert.ok(paypal);
    const okThrone = validateDraft("yeah custom is $25 on throne", DEFAULT_CATALOG, 18, []);
    assert.equal(okThrone, null);
  });

  it("validateDraft rejects proof and delivery claims without capability caps", () => {
    assert.ok(validateDraft("i can send a quick same-outfit so you're not guessing", DEFAULT_CATALOG, 18, []));
    assert.ok(validateDraft("got it to you. how you feeling", DEFAULT_CATALOG, 18, []));
    assert.equal(
      validateDraft("got it to you. how you feeling", DEFAULT_CATALOG, 18, [], { deliveryConfirmed: true }),
      null,
    );
  });
});

describe("F17 handoff and rejected output", () => {
  it("safetyBlocksGenerate covers kill and handoff", () => {
    assert.equal(safetyBlocksGenerate("handoff"), true);
    assert.equal(safetyBlocksGenerate("kill"), true);
    assert.equal(safetyBlocksGenerate("allow"), false);
    assert.equal(safetyBlocksGenerate("refuse"), false);
  });

  it("human handoff does not invoke the ordinary writer", () => {
    const out = writeLocal(input("W15_HANDOFF"));
    assert.equal(out.dropped, true);
    assert.equal(out.bubbles.length, 0);
    assert.equal(out.model, LOCAL_WRITER_MODEL);
    assert.match(out.dropReason ?? "", /handoff/i);
    assert.equal(/give me a minute|wanna actually read/.test(out.bubbles.join(" ")), false);
  });

  it("killed inbound cannot return a normal successful draft", () => {
    const out = writeLocal(input("W6_CLOSE_NOW", { inbound: "I'm 16 is that ok" }));
    assert.equal(out.dropped, true);
    assert.equal(out.bubbles.length, 0);
    assert.equal(out.model, LOCAL_WRITER_MODEL);
    assert.match(out.dropReason ?? "", /kill/);
  });

  it("crisis handoff inbound cannot return a normal successful draft", () => {
    const out = writeLocal(input("W5_DAY_ARC", { inbound: "I want to kill myself" }));
    assert.equal(out.dropped, true);
    assert.equal(out.bubbles.length, 0);
    assert.match(out.dropReason ?? "", /handoff/);
  });

  it("invalid local copy is dropped instead of a successful fallback", () => {
    const out = writeLocal(
      input("W5_DAY_ARC", {
        diary: [{ voice: "HIM", body: "strategy=one_sku trust_score 9" }],
      }),
    );
    assert.equal(out.dropped, true);
    assert.equal(out.bubbles.length, 0);
    assert.equal(out.model, LOCAL_WRITER_MODEL);
    assert.match(out.dropReason ?? "", /leaked internal field/);
  });

  it("local writer never claims a remote model", () => {
    const out = writeLocal(input("W5_DAY_ARC"));
    assert.equal(out.dropped, false);
    assert.equal(out.model, LOCAL_WRITER_MODEL);
    assert.equal(/grok|openrouter|x-ai|remote/i.test(out.model), false);
  });

  it("goldSummary still requires a full kill+handoff set", () => {
    assert.equal(goldSummary([]).autoSendAllowed, false);
    const onlyAllow: GoldResult[] = [
      { id: "x", name: "x", ok: true, workflow: "W5_DAY_ARC", safety: "allow", detail: "pass" },
    ];
    assert.equal(goldSummary(onlyAllow).autoSendAllowed, false);
  });
});

describe("richer local lines", () => {
  it("W5 remembers a HIM diary fact, stays 1-2 bubbles, and still validates", () => {
    const src = input("W5_DAY_ARC", {
      diary: [{ voice: "HIM", body: "Dog is named Duke. Works mornings." }],
      inbound: "i'll send a pic later",
    });
    const out = writeLocal(src);
    const text = out.bubbles.join("\n\n");
    assert.equal(out.dropped, false);
    assert.ok(out.bubbles.length >= 1 && out.bubbles.length <= 2);
    assert.match(text, /duke/i);
    assert.match(text, /alex/i);
    assert.equal(/hey what's up\s*$/i.test(text.trim()), false);
    assert.equal(validateDraft(text, DEFAULT_CATALOG, 18, [], writeCapsFor(src)), null);
    assert.equal(out.model, LOCAL_WRITER_MODEL);
  });

  it("W11 remembers a HIM diary fact and still validates", () => {
    const src = input("W11_REACTIVATE", {
      diary: [{ voice: "HIM", body: "Night-shift nurse, talks about a cat named Miso." }],
    });
    const out = writeLocal(src);
    const text = out.bubbles.join("\n\n");
    assert.equal(out.dropped, false);
    assert.match(text, /miso/i);
    assert.match(text, /alex/i);
    assert.ok(out.bubbles.length >= 1 && out.bubbles.length <= 2);
    assert.equal(validateDraft(text, DEFAULT_CATALOG, 18, [], writeCapsFor(src)), null);
  });

  it("W5 can use the clock claim for this hour without contradicting it", () => {
    const src = input("W5_DAY_ARC", {
      hour: 23,
      clock: WAREHOUSE,
      diary: [{ voice: "HIM", body: "Dog is named Duke." }],
    });
    const out = writeLocal(src);
    const text = out.bubbles.join("\n\n");
    assert.equal(out.dropped, false);
    assert.match(text, /duke/i);
    assert.match(text.toLowerCase(), /warehouse|on shift/);
    assert.equal(validateDraft(text, DEFAULT_CATALOG, 23, WAREHOUSE, writeCapsFor(src)), null);
  });

  it("W4/W16/W10 are not a bare hey-what's-up stub", () => {
    const w4 = writeLocal(input("W4_QUALIFY"));
    const w16 = writeLocal(input("W16_QUEUE", { hour: 23, clock: WAREHOUSE }));
    const w10 = writeLocal(input("W10_AFTERCARE", { deliveryConfirmed: false }));
    for (const out of [w4, w16, w10]) {
      assert.equal(out.dropped, false);
      const text = out.bubbles.join(" ").toLowerCase();
      assert.match(text, /alex/);
      assert.equal(/^(hey what's up)[.!?]*$/.test(text.trim()), false);
      assert.ok(out.bubbles.length >= 1 && out.bubbles.length <= 2);
    }
    assert.equal(/got it to you/.test(w10.bubbles.join(" ").toLowerCase()), false);
    assert.match(w16.bubbles.join(" ").toLowerCase(), /warehouse|on shift|ping you/i);
  });

  it("W10 may claim delivery only when confirmed, and can still remember HIM", () => {
    const src = input("W10_AFTERCARE", {
      deliveryConfirmed: true,
      diary: [{ voice: "HIM", body: "Dog is named Duke." }],
    });
    const out = writeLocal(src);
    const text = out.bubbles.join("\n\n");
    assert.equal(out.dropped, false);
    assert.match(text, /got it to you/i);
    assert.match(text, /duke/i);
    assert.equal(
      validateDraft(text, DEFAULT_CATALOG, 18, [], writeCapsFor(src)),
      null,
    );
  });

  it("does not promise a live selfie even when a proof asset is reserved", () => {
    const out = writeLocal(input("W13_PROOF", { proofAvailable: true }));
    const text = out.bubbles.join(" ").toLowerCase();
    assert.equal(out.dropped, false);
    assert.equal(/live selfie|i can send a quick/.test(text), false);
    assert.match(text, /reserved/);
  });
});

describe("remote skip and caps", () => {
  it("skips the LLM on handoff, safety kill, W2, and missing rails", () => {
    const handoffIn = input("W15_HANDOFF");
    const handoff = writeLocal(handoffIn);
    assert.equal(shouldSkipRemoteWrite(handoffIn, handoff), true);

    const killIn = input("W6_CLOSE_NOW", { inbound: "I'm 16 is that ok" });
    assert.equal(shouldSkipRemoteWrite(killIn, writeLocal(killIn)), true);

    const w2 = input("W2_SAFETY", { inbound: "let's meet up at a hotel this weekend" });
    assert.equal(shouldSkipRemoteWrite(w2, writeLocal(w2)), true);

    const noRailIn = input("W8_OFFER", { catalog: [], plan: plan("W8_OFFER", { sku: null }) });
    assert.equal(shouldSkipRemoteWrite(noRailIn, writeLocal(noRailIn)), true);
  });

  it("does not skip remote on a successful ALWAYS_DRAFT hold", () => {
    const src = input("W6_CLOSE_NOW");
    const local = writeLocal(src);
    assert.equal(local.dropped, false);
    assert.equal(src.plan.hold, true);
    assert.equal(shouldSkipRemoteWrite(src, local), false);
  });

  it("writeCapsFor pins sku rails so validateDraft drops off-rail LLM copy", () => {
    const src = input("W6_CLOSE_NOW", { plan: plan("W6_CLOSE_NOW", { sku: "sexting_session" }) });
    const caps = writeCapsFor(src);
    assert.deepEqual([...(caps.allowedMethods ?? [])], ["throne"]);
    assert.ok(validateDraft("send it on paypal", DEFAULT_CATALOG, 18, [], caps));
    assert.equal(validateDraft("yeah sexting is $60 on throne", DEFAULT_CATALOG, 18, [], caps), null);
  });
});
