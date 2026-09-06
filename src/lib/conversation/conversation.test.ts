import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFactEvents,
  classifyFinishReason,
  classifyHttpStatus,
  classifyTransportResult,
  combineHealth,
  confirmedTranscript,
  confirmedTurnCount,
  decideLiveAutoSend,
  extractProposedFacts,
  inventedQuotedAmount,
  isGreetingOnly,
  isIdentityQuestion,
  isPlaceholderName,
  isSentConfirmed,
  isStopContact,
  normalizeAnalysisText,
  parseLegacyNotes,
  resolveIdempotencyHit,
  spokenName,
  usablePartnerFacts,
  type QuoteSnapshot,
  type StoredFact,
} from "./index.ts";
import { runSafety } from "../agent/safety.ts";
import { understandLocal } from "../agent/understand.ts";
import { routeWorkflow } from "../agent/route.ts";
import { clockContradiction } from "../agent/clock.ts";
import { inventedPrice } from "../agent/catalog.ts";
import { DEFAULT_CATALOG } from "../agent/catalog.ts";
import { writeLocal } from "../agent/write.ts";
import type { CatalogRow, ClockSlot, ReplyPlan, WriteInput } from "../agent/types.ts";
import { decideAutoSend } from "../agent/auto.ts";

function plan(workflow: ReplyPlan["workflow"], extra: Partial<ReplyPlan> = {}): ReplyPlan {
  return {
    workflow,
    strategy: extra.strategy ?? "test",
    tactic: extra.tactic ?? "ask",
    offerId: null,
    sku: extra.sku ?? null,
    hold: extra.hold ?? true,
    reason: extra.reason ?? "test",
    doors: [],
    checkInHours: null,
    autonomy: extra.autonomy ?? "draft",
  };
}

function input(workflow: ReplyPlan["workflow"], extra: Partial<WriteInput> = {}): WriteInput {
  return {
    plan: plan(workflow, extra.plan),
    personaName: "Maya",
    bible: "disclosed AI persona",
    clock: [],
    hour: 18,
    diary: extra.diary ?? [],
    last: extra.last ?? [],
    catalog: extra.catalog ?? DEFAULT_CATALOG,
    fanName: extra.fanName ?? "Alex Buyer",
    inbound: extra.inbound ?? "hi",
    proofAvailable: extra.proofAvailable,
    deliveryConfirmed: extra.deliveryConfirmed,
    ...extra,
  };
}

const WAREHOUSE: ClockSlot[] = [
  { kind: "warehouse", claim: "on warehouse shift", startHour: 22, endHour: 6 },
];

describe("AC punctuation and greetings", () => {
  it("normalizes curly What’s up to the same greeting as straight What's up", () => {
    assert.equal(isGreetingOnly("What’s up"), true);
    assert.equal(isGreetingOnly("What's up"), true);
    assert.equal(isGreetingOnly("whats up"), true);
    assert.equal(isGreetingOnly("hi"), true);
    assert.equal(understandLocal("What’s up", { lifetimeCents: 0, source: "telegram", archetype: "new", turns: 1 }).intent, "greeting");
    assert.equal(understandLocal("What's up", { lifetimeCents: 0, source: "telegram", archetype: "new", turns: 1 }).intent, "greeting");
  });

  it("telegram greeting does not enter qualify / sales", () => {
    const u = understandLocal("hi", { lifetimeCents: 0, source: "telegram", archetype: "new", turns: 1 });
    const wf = routeWorkflow(runSafety("hi"), u, {
      lifetimeCents: 0,
      turns: 1,
      takeover: false,
      justDelivered: false,
      silentDays: 0,
      gfeHeld: false,
      overflow: false,
      whale: false,
      firstOfferSent: false,
    });
    assert.equal(wf, "W5_DAY_ARC");
  });

  it("local greeting has no warehouse, no price, no placeholder vocative", () => {
    const out = writeLocal(input("W5_DAY_ARC", { inbound: "What’s up", fanName: "account", hour: 23, clock: WAREHOUSE }));
    const text = out.bubbles.join(" ").toLowerCase();
    assert.equal(out.dropped, false);
    assert.equal(/warehouse|on shift|account —|yeah account/.test(text), false);
    assert.equal(/\$\d+/.test(text), false);
    assert.match(text, /hey|hi|how's|how is|going/i);
  });
});

describe("AC yes / pending question", () => {
  it("bare yes is not treated as a new free-text product ask", () => {
    const u = understandLocal("yes", { lifetimeCents: 0, source: "telegram", archetype: "new", turns: 3 });
    assert.equal(u.intent, "other");
    assert.equal(u.wantsSku, null);
  });
});

describe("AC memory subjects", () => {
  it("keeps persona Pepper and partner Duke distinct; US notes do not overwrite", () => {
    const partner = extractProposedFacts("My dog is Duke", { voice: "HIM" });
    const us = extractProposedFacts("Pepper the dog and I walked", { voice: "US" });
    assert.equal(us.length, 0);
    assert.equal(partner[0]?.value, "Duke");
    assert.equal(partner[0]?.subject, "partner");
    let facts: StoredFact[] = [];
    facts = applyFactEvents(facts, partner, "2026-01-01T00:00:00Z");
    facts = applyFactEvents(facts, extractProposedFacts("I have a dog named Pepper", { voice: "ME", speaker: "persona" }), "2026-01-01T00:00:01Z");
    const usable = usablePartnerFacts(facts);
    assert.equal(usable.pet, "Duke");
  });

  it("Austin correction survives an older Denver note", () => {
    let facts: StoredFact[] = [];
    facts = applyFactEvents(facts, extractProposedFacts("I'm in Denver"), "2026-01-01T00:00:00Z");
    facts = applyFactEvents(facts, extractProposedFacts("I moved to Austin, I'm not in Denver anymore"), "2026-06-01T00:00:00Z");
    const usable = usablePartnerFacts(facts);
    assert.equal(usable.city, "Austin");
    const olderReplay = applyFactEvents(facts, extractProposedFacts("I'm in Denver"), "2026-01-01T00:00:00Z");
    assert.equal(usablePartnerFacts(olderReplay).city, "Austin");
  });

  it("quoted, third-party, negated, and questions are not partner assertions", () => {
    assert.ok(extractProposedFacts('He said "my dog is Luna"').every((f) => f.assertion !== "asserted" || f.thirdParty));
    const third = extractProposedFacts("My sister has a dog named Luna");
    assert.ok(third.every((f) => f.thirdParty || f.subject === "third_party"));
    const denied = extractProposedFacts("I don't want a custom");
    assert.ok(denied.some((f) => f.assertion === "negated") || denied.every((f) => f.predicate !== "likes" || f.assertion === "negated"));
    const q = extractProposedFacts("is your dog named Duke?");
    assert.ok(q.every((f) => f.assertion === "question" || f.predicate !== "pet"));
  });

  it("does not extract Died as a pet or i'm Tired as a name", () => {
    assert.equal(extractProposedFacts("my dog died last year").length, 0);
    assert.ok(extractProposedFacts("i'm Tired").every((f) => f.predicate !== "name"));
  });

  it("malformed stored JSON is quarantined", () => {
    assert.equal(parseLegacyNotes("[1,2,3]").quarantined, true);
    assert.equal(parseLegacyNotes("{not json").quarantined, true);
    const ok = parseLegacyNotes(JSON.stringify({ notes: ["hi"], lastPaidCents: 2500, vibe: "direct" }));
    assert.equal(ok.quarantined, false);
    assert.equal(ok.lastPaidCents, 2500);
    assert.equal(ok.vibe, "direct");
  });
});

describe("AC names", () => {
  it("placeholder display names are not vocatives", () => {
    assert.equal(isPlaceholderName("account"), true);
    assert.equal(isPlaceholderName("Unknown"), true);
    assert.equal(isPlaceholderName("Telegram"), true);
    assert.equal(spokenName("account"), null);
    assert.equal(spokenName("Alex Buyer"), "Alex");
    assert.equal(spokenName("Unknown", "Sam"), "Sam");
  });
});

describe("AC transcript", () => {
  it("approved and local notes are not confirmed history", () => {
    const rows = [
      { role: "fan", body: "hi", status: "sent" },
      { role: "persona", body: "unsent draft", status: "approved" },
      { role: "persona", body: "operator note", status: "local" },
      { role: "persona", body: "hey", status: "sent" },
    ];
    const t = confirmedTranscript(rows);
    assert.deepEqual(t.map((m) => m.body), ["hi", "hey"]);
    assert.equal(confirmedTurnCount(rows), 2);
  });
});

describe("AC safety / opt-out / age / identity", () => {
  it("explicit opt-out is detected", () => {
    assert.equal(isStopContact("Please stop messaging me."), true);
    const s = runSafety("Please stop messaging me.");
    assert.ok(s.codes.includes("opt_out"));
  });

  it("spelled-out and short age signals kill", () => {
    assert.equal(runSafety("I'm seventeen").verdict, "kill");
    assert.equal(runSafety("I am 9").verdict, "kill");
    assert.equal(runSafety("I'm 16 is that ok").verdict, "kill");
  });

  it("lawyer as a job is not reverse-scam", () => {
    const s = runSafety("I work as a lawyer");
    assert.equal(s.verdict, "allow");
    assert.equal(s.codes.includes("reverse_scam"), false);
  });

  it("identity question is not prompt-injection", () => {
    assert.equal(isIdentityQuestion("Are you a real person?"), true);
    const s = runSafety("Are you a real person?");
    assert.equal(s.verdict, "allow");
    const u = understandLocal("Are you a real person?", { lifetimeCents: 0, source: "telegram", archetype: "new", turns: 1 });
    assert.equal(u.intent, "identity_ask");
    const wf = routeWorkflow(s, u, {
      lifetimeCents: 0,
      turns: 1,
      takeover: false,
      justDelivered: false,
      silentDays: 0,
      gfeHeld: false,
      overflow: false,
      whale: false,
      firstOfferSent: false,
    });
    assert.notEqual(wf, "W13_PROOF");
  });
});

describe("AC auto-send containment", () => {
  it("local templates, off switch, emergency stop, and not_live never auto-send", () => {
    const base = {
      personaAutoSend: true,
      goldAllowed: true,
      quiet: false,
      takeover: false,
      workflow: "W5_DAY_ARC" as const,
      dropped: false,
      killed: false,
      bubbleCount: 1,
      safetyVerdict: "allow" as const,
    };
    assert.equal(decideAutoSend({ ...base, personaAutoSend: false }), false);
    assert.equal(decideLiveAutoSend({ ...base, generationOrigin: "local_template", automationMode: "approved_auto" }).send, false);
    assert.equal(decideLiveAutoSend({ ...base, generationOrigin: "validated_model", emergencyStop: true, automationMode: "approved_auto" }).send, false);
    assert.equal(decideLiveAutoSend({ ...base, generationOrigin: "validated_model", accountLive: false, automationMode: "approved_auto" }).send, false);
    assert.equal(decideLiveAutoSend({ ...base, generationOrigin: "validated_model", partnerOptOut: true, automationMode: "approved_auto" }).send, false);
    assert.equal(decideLiveAutoSend({ ...base, generationOrigin: "validated_model", automationMode: "draft" }).send, false);
    assert.equal(decideLiveAutoSend({ ...base, generationOrigin: "validated_model", automationMode: "approved_auto" }).send, true);
    assert.equal(decideLiveAutoSend({ ...base, generationOrigin: "validated_model", personaAutoSend: false, automationMode: "approved_auto" }).send, false);
    assert.equal(decideLiveAutoSend({ ...base, generationOrigin: "validated_model" }).send, false);
  });

  it("gold remaining off does not by itself block an approved-auto validated reply", () => {
    assert.equal(
      decideLiveAutoSend({
        personaAutoSend: true,
        goldAllowed: false,
        quiet: true,
        takeover: false,
        workflow: "W5_DAY_ARC",
        dropped: false,
        killed: false,
        bubbleCount: 1,
        safetyVerdict: "allow",
        generationOrigin: "validated_model",
        automationMode: "approved_auto",
        adultEligibility: "allowed",
        accountLive: true,
        conversationPermitted: true,
      }).send,
      true,
    );
  });
});

describe("AC dispatch", () => {
  it("not_live, null, true, and missing ack are not sent", () => {
    assert.equal(classifyTransportResult({ ok: true, status: "not_live" }).kind, "not_live");
    assert.equal(classifyTransportResult(null).kind, "uncertain");
    assert.equal(classifyTransportResult(true).kind, "uncertain");
    assert.equal(classifyTransportResult({ ok: true, status: "sent" }).kind, "uncertain");
    const ok = classifyTransportResult({ ok: true, status: "sent", telegramMessageId: 99 });
    assert.equal(ok.kind, "sent_confirmed");
    assert.equal(isSentConfirmed(ok), true);
  });
});

describe("AC idempotency reclaim", () => {
  const now = Date.parse("2026-09-06T12:00:00Z");
  it("replays a completed result", () => {
    const hit = resolveIdempotencyHit(
      { status: "completed", result_json: JSON.stringify({ threadId: "thr_1", workflow: "W5_DAY_ARC", held: false, killed: false, auto: true }), thread_id: "thr_1" },
      now,
    );
    assert.equal(hit.action, "replay");
    if (hit.action === "replay") assert.equal(hit.result.threadId, "thr_1");
  });

  it("holds a live lease as in-flight", () => {
    const hit = resolveIdempotencyHit(
      { status: "claimed", result_json: null, thread_id: "thr_1", lease_until: "2026-09-06T12:01:00Z" },
      now,
    );
    assert.equal(hit.action, "in_flight");
  });

  it("reclaims an expired or missing lease instead of short-circuiting", () => {
    assert.equal(
      resolveIdempotencyHit({ status: "claimed", result_json: null, thread_id: "thr_1", lease_until: "2026-09-06T11:59:00Z" }, now).action,
      "reclaim",
    );
    assert.equal(
      resolveIdempotencyHit({ status: "claimed", result_json: null, thread_id: "thr_1", lease_until: null }, now).action,
      "reclaim",
    );
  });
});

describe("AC provider", () => {
  it("classifies 401/402/429/503 and finish reasons", () => {
    assert.equal(classifyHttpStatus(401), "unauthorized");
    assert.equal(classifyHttpStatus(402), "payment_required");
    assert.equal(classifyHttpStatus(429), "rate_limited");
    assert.equal(classifyHttpStatus(503), "unavailable");
    assert.equal(classifyFinishReason("length", "hello"), "truncated");
    assert.equal(classifyFinishReason("stop", ""), "empty");
    assert.equal(classifyFinishReason("content_filter", "no"), "refusal");
  });

  it("stale success plus a failed probe is degraded", () => {
    assert.equal(
      combineHealth({ configured: true, lastAuthOk: true, lastGenerationOk: false, lastGenerationAt: Date.now() - 60_000 }),
      "degraded",
    );
  });
});

describe("AC clock", () => {
  it("questions and negations are not persona activity claims", () => {
    assert.equal(clockContradiction("How was the gym?", 23, WAREHOUSE), null);
    assert.equal(clockContradiction("I am not at the gym", 23, WAREHOUSE), null);
  });
});

describe("AC quotes", () => {
  it("rejects wrong-product and fractional amounts against an exact quote", () => {
    const quote: QuoteSnapshot = {
      id: "q1",
      productId: "sku_custom",
      sku: "custom_clip",
      amountMinor: 2500,
      currency: "USD",
      merchantId: "m1",
      paymentMethod: "throne",
      status: "approved",
    };
    assert.equal(inventedQuotedAmount("that's $25.49", quote, DEFAULT_CATALOG), 25.49);
    assert.equal(inventedQuotedAmount("video call is $25", { ...quote, sku: "video_call", amountMinor: 12000 }, DEFAULT_CATALOG), 25);
    assert.equal(inventedQuotedAmount("a custom is $25", quote, DEFAULT_CATALOG), null);
  });

  it("global allowlist is not enough without a quote", () => {
    const dollars = inventedPrice("video call is $25", DEFAULT_CATALOG);
    assert.equal(dollars, null);
    const exact = inventedQuotedAmount(
      "video call is $25",
      {
        id: "q2",
        productId: "sku_call",
        sku: "video_call",
        amountMinor: 12000,
        currency: "USD",
        merchantId: "m1",
        paymentMethod: "throne",
        status: "approved",
      },
      DEFAULT_CATALOG,
    );
    assert.equal(exact, 25);
  });
});

describe("AC analysis text", () => {
  it("normalizeAnalysisText is lossless for intent vs original curly marks", () => {
    const original = "What’s up";
    assert.equal(original.includes("’"), true);
    assert.equal(normalizeAnalysisText(original), "What's up");
  });
});
