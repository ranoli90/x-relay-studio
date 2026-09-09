import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { money, moneyFromFractional, formatMoney, sameMoney } from "./money.ts";
import {
  applyTransportOutcome,
  canRetryAttempt,
  cloneFinalState,
  reconcileUncertain,
  revalidateForSend,
  type FinalState,
  type SendAttempt,
} from "./state.ts";
import { applyReadAck, shouldMarkRead } from "./unread.ts";
import { selectConfirmedHistory, type HistoryItem } from "./history.ts";
import { fairnessRoundsToCover, nextIngestBatch, type IngestCursor } from "./ingest.ts";
import { addOfferToDraft, canPublish, draftFromBrief, offerForGeneration, planningCatalog } from "./business.ts";
import { evaluatePaymentEvidence, mixesCreditWithCustomer, publicPaymentView } from "./payments.ts";
import { attachmentCaption, canProposeAsset, deliveryAfterTransport, honestMediaCopy } from "./media.ts";
import {
  ackVisible,
  addBenignOffer,
  createWorld,
  defaultFlags,
  dispatchAttempt,
  historyForModel,
  liveFlags,
  publishRevision,
  retryAttempt,
  saveDraft,
  submitBrief,
  tickIngest,
} from "./kernel.ts";

function flags(extra: Partial<FinalState> = {}): FinalState {
  return {
    ...defaultFlags(),
    automationMode: "approved_auto",
    processingPermission: true,
    conversationPermitted: extra.optOut === true ? false : true,
    ...extra,
  };
}

function attempt(status: SendAttempt["status"], extra: Partial<SendAttempt> = {}): SendAttempt {
  return {
    id: "att_1",
    conversationId: "c1",
    body: "hello",
    status,
    captured: flags(),
    transportMessageId: null,
    uncertainReason: status === "uncertain" ? "ok_without_ack_id" : null,
    reconciledAs: null,
    ...extra,
  };
}

describe("TG-12 stale object is not revalidation", () => {
  it("rejects the same object passed twice", () => {
    const live = flags();
    const result = revalidateForSend(live, live);
    assert.equal(result.allow, false);
    if (!result.allow) assert.equal(result.reason, "stale_object_not_revalidated");
  });

  it("allows a freshly loaded clone with the same values", () => {
    const captured = flags();
    const live = cloneFinalState(captured);
    const result = revalidateForSend(captured, live);
    assert.equal(result.allow, true);
  });

  it("rejects a permission revision change on a distinct live object", () => {
    const captured = flags();
    const live = { ...cloneFinalState(captured), permissionRevision: 2, processingPermission: false };
    const result = revalidateForSend(captured, live);
    assert.equal(result.allow, false);
    if (!result.allow) assert.equal(result.reason, "permission_revoked");
  });
});

describe("TG-14 stop/takeover/opt-out/permission during blocked transport", () => {
  it("does not send after Stop while fake transport hangs", async () => {
    const world = createWorld();
    world.flags = flags();
    world.transport.startHang();
    const captured = liveFlags(world);
    const pending = dispatchAttempt(world, {
      conversationId: "chat_1",
      body: "hi there",
      captured,
    });
    world.flags = { ...world.flags, emergencyStop: true };
    world.transport.releaseHang({ kind: "sent_confirmed", transportMessageId: "should_not_count" });
    const result = await pending;
    assert.equal(result.status, "uncertain");
    assert.match(result.uncertainReason ?? "", /possible_transmission:emergency_stop/);
    assert.equal(world.transport.sent.length, 1);
    assert.equal(world.history.filter((h) => h.kind === "confirmed_outbound").length, 0);
  });

  it("does not send after takeover, opt-out, or permission revoke", async () => {
    for (const change of [
      { takeover: true },
      { optOut: true },
      { processingPermission: false, permissionRevision: 2 },
    ] as Partial<FinalState>[]) {
      const world = createWorld();
      world.flags = flags();
      world.transport.startHang();
      const captured = liveFlags(world);
      const pending = dispatchAttempt(world, { conversationId: "c", body: "x", captured });
      world.flags = { ...world.flags, ...change };
      world.transport.releaseHang({ kind: "sent_confirmed", transportMessageId: "x" });
      const result = await pending;
      assert.equal(result.status, "uncertain", JSON.stringify(change));
      assert.match(result.uncertainReason ?? "", /possible_transmission/);
      assert.equal(world.history.filter((h) => h.kind === "confirmed_outbound").length, 0);
    }
  });
});

describe("TG-15 no duplicate send after uncertain", () => {
  it("blocks retry until reconciled", () => {
    const open = attempt("uncertain");
    assert.equal(canRetryAttempt(open).allow, false);
    const failed = reconcileUncertain(open, null);
    assert.equal(failed.status, "failed");
    assert.equal(canRetryAttempt(failed).allow, true);
    const confirmed = reconcileUncertain(open, { transportMessageId: "tg_1" });
    assert.equal(confirmed.status, "confirmed");
    assert.equal(canRetryAttempt(confirmed).allow, false);
  });

  it("does not treat model-ok-without-ack as confirmed", () => {
    const next = applyTransportOutcome(attempt("sending"), {
      kind: "uncertain",
      reason: "ok_without_ack_id",
    });
    assert.equal(next.status, "uncertain");
  });

  it("retryAttempt refuses an unreconciled uncertain row", () => {
    const world = createWorld();
    world.attempts.push(attempt("uncertain", { id: "att_u" }));
    const again = retryAttempt(world, "att_u");
    assert.ok("error" in again);
    if ("error" in again) assert.equal(again.error, "uncertain_unreconciled");
  });
});

describe("visibility-aware unread", () => {
  it("does not clear unread when only the chat list is visible", () => {
    assert.equal(
      shouldMarkRead({
        conversationVisible: false,
        documentVisible: true,
        chatListOnly: true,
        explicitAck: true,
      }),
      false,
    );
    assert.equal(applyReadAck(3, {
      conversationVisible: false,
      documentVisible: true,
      chatListOnly: true,
      explicitAck: false,
    }), 3);
  });

  it("clears unread only on explicit visible conversation ack", () => {
    const world = createWorld();
    world.conversations.push({
      id: "c1",
      bindingId: world.bindingId,
      creatorId: world.creatorId,
      title: "Alex",
      unread: 4,
      peerId: "peer_1",
    });
    assert.equal(ackVisible(world, "c1", {
      conversationVisible: true,
      documentVisible: true,
      chatListOnly: false,
      explicitAck: true,
    }), 0);
  });
});

describe("business configuration vertical slice", () => {
  it("brief -> review -> publish -> reload uses that revision for generation", () => {
    const world = createWorld();
    const draft = submitBrief(world, "Northlight notes\nQuiet photo notes for collectors.");
    const offer = addBenignOffer(world, draft.id, {
      title: "Photo notes pack",
      amountMinor: 1250,
      currency: "USD",
    });
    assert.equal(offer.amount.minor, 1250);
    assert.equal(formatMoney(offer.amount), "$12.50");
    const published = publishRevision(world, draft.id);
    assert.equal(published.revision, 1);
    assert.equal(published.offers[0]?.amount.minor, 1250);
    const catalog = planningCatalog(published);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.priceCents, 1250);
    const hit = offerForGeneration(published, offer.id, world.creatorId);
    assert.ok(!("error" in hit));
    if (!("error" in hit)) {
      assert.equal(hit.amount.minor, 1250);
      assert.equal(hit.amount.currency, "USD");
    }
  });

  it("unavailable offer and wrong-creator isolation", () => {
    const world = createWorld();
    const draft = submitBrief(world, "Studio");
    const live = addBenignOffer(world, draft.id, {
      title: "Photo notes pack",
      amountMinor: 1250,
      currency: "USD",
    });
    const gone = addBenignOffer(world, draft.id, {
      title: "Closed set",
      amountMinor: 500,
      currency: "USD",
      available: false,
    });
    const published = publishRevision(world, draft.id);
    const miss = offerForGeneration(published, gone.id, world.creatorId);
    assert.ok("error" in miss);
    if ("error" in miss) assert.equal(miss.error, "offer_unavailable");
    const wrong = offerForGeneration(published, live.id, "creator_other");
    assert.ok("error" in wrong);
    if ("error" in wrong) assert.equal(wrong.error, "wrong_creator");
  });

  it("a later published revision is the one generation sees", () => {
    const world = createWorld();
    const first = submitBrief(world, "V1");
    addBenignOffer(world, first.id, { title: "Pack A", amountMinor: 1000, currency: "USD" });
    publishRevision(world, first.id);
    const second = submitBrief(world, "V2");
    const offer = addBenignOffer(world, second.id, {
      title: "Pack B",
      amountMinor: 1999,
      currency: "USD",
    });
    const published = publishRevision(world, second.id);
    assert.equal(published.revision, 2);
    assert.equal(published.offers[0]?.id, offer.id);
    assert.equal(world.revisions[0]?.status, "superseded");
    assert.equal(planningCatalog(published)[0]?.priceCents, 1999);
  });

  it("does not invent a catalog from an empty unpublished brief", () => {
    const structured = addOfferToDraft(draftFromBrief("Hello"), {
      title: "Pack",
      amountMinor: 100,
      currency: "USD",
    });
    assert.equal(canPublish(structured).ok, true);
    assert.deepEqual(planningCatalog(null), []);
  });
});

describe("payments stay separate from workspace credits", () => {
  it("rejects wrong currency and wrong destination", () => {
    const amount = moneyFromFractional(12.5, "USD");
    assert.equal(evaluatePaymentEvidence({
      offerAmount: amount,
      offerCurrency: "USD",
      evidenceAmount: money(1250, "EUR"),
      destinationId: "dest_1",
      expectedDestinationId: "dest_1",
    }).accept, false);
    assert.equal(evaluatePaymentEvidence({
      offerAmount: amount,
      offerCurrency: "USD",
      evidenceAmount: money(1250, "USD"),
      destinationId: "dest_other",
      expectedDestinationId: "dest_1",
    }).accept, false);
    assert.equal(evaluatePaymentEvidence({
      offerAmount: amount,
      offerCurrency: "USD",
      evidenceAmount: money(1250, "USD"),
      destinationId: "dest_1",
      expectedDestinationId: "dest_1",
    }).accept, true);
  });

  it("public view never includes credentials", () => {
    const view = publicPaymentView({
      instruction: {
        id: "ins_1",
        creatorId: "c",
        bindingId: "b",
        revisionId: "r",
        publicCopy: "Send USD to the listed handle.",
        currency: "USD",
        approved: true,
      },
      destination: {
        id: "dest_1",
        creatorId: "c",
        bindingId: "b",
        provider: "manual_handle",
        destinationRef: "@studio_pay",
        currency: "USD",
        hasCredential: true,
      },
    });
    assert.equal(view.copy, "Send USD to the listed handle.");
    assert.equal(view.destinationRef, "@studio_pay");
    assert.equal(JSON.stringify(view).includes("envelope"), false);
    assert.equal(JSON.stringify(view).includes("secret"), false);
    assert.equal(mixesCreditWithCustomer("workspace_credit", "customer_offer"), true);
  });
});

describe("media pipeline", () => {
  it("accepts a captionless incoming attachment", () => {
    const att = {
      id: "att_1",
      conversationId: "c1",
      kind: "image" as const,
      caption: "   ",
      providerMediaId: "tgfile_1",
      bytesAvailable: true,
      providerAt: "2026-09-01T00:00:00.000Z",
    };
    assert.equal(attachmentCaption(att), null);
  });

  it("missing or revoked media cannot be sent", () => {
    assert.equal(canProposeAsset(null).ok, false);
    const revoked = {
      id: "asset_1",
      ownerUserId: "u",
      bindingId: "b",
      kind: "image" as const,
      title: "Set still",
      mime: "image/jpeg",
      byteSize: 1200,
      storageKey: "mem:1",
      approval: "revoked" as const,
      provesLiveHuman: false as const,
    };
    assert.equal(canProposeAsset(revoked).ok, false);
    const proposal = { id: "p1", conversationId: "c", assetId: "asset_1", status: "queued" as const };
    const after = deliveryAfterTransport(proposal, revoked, "confirmed");
    assert.equal(after.status, "revoked");
    assert.match(honestMediaCopy({ ...revoked, approval: "approved" }), /not proof of a live person/i);
  });
});

describe("drafts, history, ingest fairness", () => {
  it("drafts survive a world reload of the same store", () => {
    const world = createWorld();
    saveDraft(world, "c1", "still writing");
    assert.equal(world.drafts.c1, "still writing");
  });

  it("filters local notes before the history limit", () => {
    const items: HistoryItem[] = [
      { id: "1", kind: "local_note", body: "note", providerAt: null, localAt: "t1" },
      { id: "2", kind: "confirmed_inbound", body: "hi", providerAt: "p1", localAt: "t2" },
      { id: "3", kind: "draft", body: "draft", providerAt: null, localAt: "t3" },
      { id: "4", kind: "confirmed_outbound", body: "hello", providerAt: "p2", localAt: "t4" },
      { id: "5", kind: "confirmed_inbound", body: "ok", providerAt: "p3", localAt: "t5" },
    ];
    const selected = selectConfirmedHistory(items, 2);
    assert.deepEqual(selected.map((s) => s.id), ["4", "5"]);
    const world = createWorld();
    world.history = items;
    assert.deepEqual(historyForModel(world, 2).map((h) => h.id), ["4", "5"]);
  });

  it("every eligible chat is ingested under a bounded batch", () => {
    const cursors: IngestCursor[] = Array.from({ length: 9 }, (_, i) => ({
      conversationId: `c${i}`,
      lastProviderAt: null,
      lastAttemptAt: i,
      nextEligibleAt: 0,
      errorCount: 0,
    }));
    const seen = new Set<string>();
    let now = 0;
    const rounds = fairnessRoundsToCover(9, 4);
    assert.equal(rounds, 3);
    let pool = cursors;
    for (let r = 0; r < rounds; r += 1) {
      const batch = nextIngestBatch(pool, now, 4);
      assert.ok(batch.length <= 4);
      for (const c of batch) {
        seen.add(c.conversationId);
        const idx = pool.findIndex((x) => x.conversationId === c.conversationId);
        pool[idx] = { ...c, lastAttemptAt: now + 1, nextEligibleAt: now + 60_000 };
      }
      now += 1;
    }
    assert.equal(seen.size, 9);
    const world = createWorld();
    world.cursors = cursors.map((c) => ({ ...c, nextEligibleAt: world.now }));
    const first = tickIngest(world);
    assert.equal(first.length, 4);
  });
});

describe("money exactness", () => {
  it("keeps fractional minor units and currency", () => {
    const m = moneyFromFractional(12.5, "usd");
    assert.equal(m.minor, 1250);
    assert.equal(m.currency, "USD");
    assert.equal(sameMoney(m, money(1250, "USD")), true);
  });

  it("does not invent USD and keeps JPY as zero-exponent", () => {
    assert.equal(formatMoney(money(1250, "USD")), "$12.50");
    assert.equal(formatMoney(money(1250, "JPY")), "JPY 1250");
    assert.throws(() => money(12.5, "USD"));
  });
});

describe("interpretation is not a keyword purchase", () => {
  it("resolves a catalog product and a negated product separately", async () => {
    const { interpretMessage } = await import("./interpret.ts");
    const catalog = [
      { id: "1", sku: "photo_notes_pack", title: "Photo notes pack", priceCents: 1250, rail: "", eligibility: "any", currency: "USD" },
    ];
    const ask = interpretMessage("how much is the photo notes pack?", {
      lifetimeCents: 0,
      source: "telegram",
      archetype: "new",
      turns: 1,
      catalog,
    });
    assert.equal(ask.result.intent, "price_ask");
    assert.equal(ask.result.wantsSku, "photo_notes_pack");
    const no = interpretMessage("I don't want the photo notes pack", {
      lifetimeCents: 0,
      source: "telegram",
      archetype: "new",
      turns: 2,
      catalog,
    });
    assert.ok(no.negatedSkus.includes("photo_notes_pack"));
    assert.equal(no.result.wantsSku, null);
  });

  it("resolves yes against the pending payment question", async () => {
    const { interpretMessage } = await import("./interpret.ts");
    const yes = interpretMessage("yes", {
      lifetimeCents: 0,
      source: "telegram",
      archetype: "new",
      turns: 3,
      pendingQuestion: { kind: "payment_method", text: "Want the listed USD handle?" },
    });
    assert.equal(yes.answerToPending?.kind, "payment_method");
    assert.equal(yes.answerToPending?.affirmed, true);
    assert.equal(yes.paymentClaim, false);

  });

  it("does not infer whale or time-waster from spend or turns", async () => {
    const { interpretMessage } = await import("./interpret.ts");
    const hi = interpretMessage("hey", {
      lifetimeCents: 80_000,
      source: "telegram",
      archetype: "new",
      turns: 20,
    });
    assert.equal(hi.result.archetype, "buyer");
    assert.notEqual(hi.result.intent, "time_waste");
    assert.notEqual(hi.result.archetype, "whale");
    assert.notEqual(hi.result.archetype, "time_waster");
  });
});

describe("effective auto-reply vs desired", () => {
  it("stop wins and does not rearm", async () => {
    const { effectiveAutoReply, publicEffectiveLabel } = await import("./effective-state.ts");
    const stopped = effectiveAutoReply({
      desiredAutoReply: true,
      emergencyStop: true,
      processingPermission: true,
      connected: true,
      publishedOffers: 1,
      writerReady: true,
      takeover: false,
      optOut: false,
      uncertainSend: false,
      awaitingPaymentVerification: false,
      lastSuccessAt: null,
    });
    assert.equal(stopped.effective, "stopped");
    assert.equal(stopped.desired, true);
    assert.match(publicEffectiveLabel(stopped), /Stopped/);
  });

  it("permission off is not an on switch", async () => {
    const { effectiveAutoReply } = await import("./effective-state.ts");
    const blocked = effectiveAutoReply({
      desiredAutoReply: true,
      emergencyStop: false,
      processingPermission: false,
      connected: true,
      publishedOffers: 1,
      writerReady: true,
      takeover: false,
      optOut: false,
      uncertainSend: false,
      awaitingPaymentVerification: false,
      lastSuccessAt: null,
    });
    assert.equal(blocked.effective, "blocked_by_permission");
  });
});

describe("writer health is not key presence", () => {
  it("authenticated is not ready; route_capable is", async () => {
    const { combineHealth, healthIsReady } = await import("../conversation/generate.ts");
    assert.equal(healthIsReady("authenticated"), false);
    assert.equal(healthIsReady("configured"), false);
    assert.equal(healthIsReady("route_capable"), true);
    assert.equal(
      combineHealth({ configured: true, lastAuthOk: true, lastGenerationOk: true, lastGenerationAt: Date.now() }),
      "recently_generated",
    );
    assert.equal(healthIsReady("recently_generated"), true);
  });
});

describe("bounded inbound burst", () => {
  it("waits inside the quiet window and flushes at the cap or when empty", async () => {
    const { burstDecision, BURST_QUIET_MS, BURST_MAX_MS } = await import("./debounce.ts");
    const first = 1_000_000;
    assert.equal(
      burstDecision({ firstInboundAt: first, lastInboundAt: first + 200, now: first + 200, pendingAfter: 2 }),
      "wait",
    );
    assert.equal(
      burstDecision({ firstInboundAt: first, lastInboundAt: first, now: first + BURST_QUIET_MS, pendingAfter: 1 }),
      "flush",
    );
    assert.equal(
      burstDecision({
        firstInboundAt: first,
        lastInboundAt: first + 100,
        now: first + BURST_MAX_MS,
        pendingAfter: 5,
      }),
      "flush",
    );
    assert.equal(
      burstDecision({ firstInboundAt: first, lastInboundAt: first, now: first, pendingAfter: 0 }),
      "flush",
    );
  });
});

describe("quote snapshots", () => {
  it("fails closed without currency and formats an exact snapshot", async () => {
    const { quoteFromOffer, quoteView } = await import("./quotes.ts");
    const missing = quoteFromOffer({
      sku: "photo_notes_pack",
      title: "Photo notes",
      amountMinor: 1250,
      currency: "",
      businessRevision: 1,
      customerId: "c1",
    });
    assert.equal("error" in missing, true);
    if ("error" in missing) assert.equal(missing.error, "currency_missing");
    const ok = quoteFromOffer({
      sku: "photo_notes_pack",
      title: "Photo notes",
      amountMinor: 1250,
      currency: "USD",
      businessRevision: 1,
      customerId: "c1",
    });
    assert.equal("error" in ok, false);
    if (!("error" in ok)) {
      assert.equal(quoteView(ok).amountLabel, "$12.50");
      assert.equal(ok.amount.currency, "USD");
    }
  });
});

describe("tenant memory", () => {
  it("does not mix two same-named customers and supports forget/correct", async () => {
    const { factsForCustomer, forgetFact, correctFact, promptLines } = await import("./memory.ts");
    const facts = [
      {
        id: "f1",
        userId: "u1",
        customerId: "alex_a",
        subject: "partner",
        predicate: "city",
        value: "denver",
        status: "active" as const,
        speaker: "customer" as const,
        assertion: "asserted" as const,
      },
      {
        id: "f2",
        userId: "u2",
        customerId: "alex_a",
        subject: "partner",
        predicate: "city",
        value: "osaka",
        status: "active" as const,
        speaker: "customer" as const,
        assertion: "asserted" as const,
      },
    ];
    assert.deepEqual(promptLines(facts, "u1", "alex_a"), ["city=denver"]);
    assert.deepEqual(promptLines(facts, "u2", "alex_a"), ["city=osaka"]);
    assert.equal(factsForCustomer(facts, "u1", "alex_a").length, 1);
    const forgottenByOther = forgetFact(facts, "f1", "u2");
    assert.equal(forgottenByOther.find((f) => f.id === "f1")?.status, "active");
    const deleted = forgetFact(facts, "f1", "u1");
    assert.equal(deleted.find((f) => f.id === "f1")?.status, "deleted");
    const corrected = correctFact(facts, { id: "f1", userId: "u1", value: "boulder", replacementId: "f3" });
    assert.equal(corrected.find((f) => f.id === "f1")?.status, "superseded");
    assert.equal(corrected.find((f) => f.id === "f3")?.value, "boulder");
    assert.equal(corrected.find((f) => f.id === "f3")?.status, "active");
  });
});

describe("deletion inventory", () => {
  it("covers every operator derived table and cannot rehydrate from them", async () => {
    const { OPERATOR_ERASE_TABLES, eraseStatements, cannotRehydrateFrom } = await import("./erase.ts");
    assert.equal(OPERATOR_ERASE_TABLES.length, 17);
    assert.ok(OPERATOR_ERASE_TABLES.includes("memory_facts"));
    assert.ok(OPERATOR_ERASE_TABLES.includes("operator_quotes"));
    assert.ok(OPERATOR_ERASE_TABLES.includes("payment_credentials"));
    assert.ok(OPERATOR_ERASE_TABLES.includes("business_revisions"));
    const stmts = eraseStatements();
    assert.equal(stmts.length, 17);
    assert.ok(stmts.every((s) => s.sql.includes("where user_id")));
    assert.equal(cannotRehydrateFrom("memory_facts"), true);
  });
});

describe("catalog line never infers USD", () => {
  it("throws without a currency", async () => {
    const { catalogLine } = await import("./business.ts");
    assert.throws(() =>
      catalogLine({
        id: "1",
        sku: "x",
        title: "X",
        priceCents: 100,
        currency: "",
        rail: "",
        available: true,
        eligibility: "any",
      }),
    );
  });
});

describe("production fail-closed contracts", () => {
  it("does not revive a deleted fact via correctFact", async () => {
    const { forgetFact, correctFact } = await import("./memory.ts");
    const facts = [
      {
        id: "f1",
        userId: "u1",
        customerId: "c1",
        subject: "partner",
        predicate: "city",
        value: "denver",
        status: "active" as const,
        speaker: "customer" as const,
        assertion: "asserted" as const,
      },
    ];
    const deleted = forgetFact(facts, "f1", "u1");
    const revived = correctFact(deleted, { id: "f1", userId: "u1", value: "boulder", replacementId: "f9" });
    assert.equal(revived.find((f) => f.id === "f1")?.status, "deleted");
    assert.equal(revived.some((f) => f.id === "f9"), false);
  });

  it("clamps promptLines to a non-negative limit", async () => {
    const { promptLines } = await import("./memory.ts");
    const facts = Array.from({ length: 4 }, (_, i) => ({
      id: `f${i}`,
      userId: "u1",
      customerId: "c1",
      subject: "partner",
      predicate: `p${i}`,
      value: `v${i}`,
      status: "active" as const,
      speaker: "customer" as const,
      assertion: "asserted" as const,
    }));
    assert.deepEqual(promptLines(facts, "u1", "c1", -3), []);
    assert.equal(promptLines(facts, "u1", "c1", 1.9).length, 1);
  });

  it("never schedules a burst retry past the hard cap", async () => {
    const { nextBurstRetryAt, BURST_MAX_MS } = await import("./debounce.ts");
    const first = 1_000_000;
    const now = first + BURST_MAX_MS - 200;
    const at = nextBurstRetryAt(now, { firstInboundAt: first }).getTime();
    assert.ok(at <= first + BURST_MAX_MS);
    assert.ok(at >= now);
  });

  it("rejects unsafe integers as money", () => {
    assert.throws(() => money(Number.MAX_SAFE_INTEGER + 1, "USD"));
    assert.throws(() => money(1.5, "USD"));
  });

  it("formats JPY and KWD without assuming two decimals", async () => {
    const { minorToFractionalString } = await import("./money.ts");
    assert.equal(minorToFractionalString(1250, "JPY"), "1250");
    assert.equal(minorToFractionalString(1234, "KWD"), "1.234");
    assert.equal(minorToFractionalString(1250, "USD"), "12.50");
  });

  it("does not report an approved payment view without a matching destination", () => {
    const missing = publicPaymentView({
      instruction: {
        id: "ins_1",
        creatorId: "c",
        bindingId: "b",
        revisionId: "r",
        publicCopy: "Send USD to the listed handle.",
        currency: "USD",
        approved: true,
      },
      destination: null,
    });
    assert.equal(missing.approved, false);
    assert.equal(missing.destinationRef, null);
    const mismatched = publicPaymentView({
      instruction: {
        id: "ins_1",
        creatorId: "c",
        bindingId: "b",
        revisionId: "r",
        publicCopy: "Send USD to the listed handle.",
        currency: "USD",
        approved: true,
      },
      destination: {
        id: "dest_1",
        creatorId: "c",
        bindingId: "b",
        provider: "manual_handle",
        destinationRef: "@yen_pay",
        currency: "JPY",
        hasCredential: true,
      },
    });
    assert.equal(mismatched.approved, false);
    assert.equal(mismatched.destinationRef, null);
  });

  it("createWorld starts with processing permission off", async () => {
    const world = createWorld();
    assert.equal(world.flags.processingPermission, false);
    assert.equal(world.flags.conversationPermitted, false);
    const captured = liveFlags(world);
    const result = await dispatchAttempt(world, {
      conversationId: "c1",
      body: "hi",
      captured,
    });
    assert.equal(result.status, "canceled");
    assert.equal(world.transport.sent.length, 0);
  });

  it("resolves catalog aliases with Unicode word boundaries", async () => {
    const { resolveCatalogSku } = await import("./interpret.ts");
    const catalog = [
      {
        id: "1",
        sku: "photo_notes_pack",
        title: "фото набор",
        priceCents: 1250,
        rail: "",
        eligibility: "any",
        currency: "USD",
      },
    ];
    assert.equal(resolveCatalogSku("сколько стоит фото набор?", catalog), "photo_notes_pack");
    assert.equal(resolveCatalogSku("фотонабор", catalog), null);
  });

  it("maps pics / photos to a published photo pack, not a custom clip", async () => {
    const { resolveCatalogSku } = await import("./interpret.ts");
    const catalog = [
      {
        id: "pack",
        sku: "photo_notes_pack",
        title: "Photo notes pack",
        priceCents: 1250,
        rail: "manual_handle",
        eligibility: "any",
        currency: "USD",
      },
      {
        id: "custom",
        sku: "custom_clip",
        title: "Custom clip",
        priceCents: 2500,
        rail: "manual_handle",
        eligibility: "any",
        currency: "USD",
      },
    ];
    assert.equal(resolveCatalogSku("how much for pics", catalog), "photo_notes_pack");
    assert.equal(resolveCatalogSku("how much for photos", catalog), "photo_notes_pack");
    assert.equal(resolveCatalogSku("custom clip please", catalog), "custom_clip");
    assert.equal(
      resolveCatalogSku("photos", [{ ...catalog[0], sku: "music_pack", title: "Music pack" }]),
      null,
    );
    const twoPacks = [
      { ...catalog[0], id: "urban", sku: "urban_pack", title: "Urban photo pack" },
      { ...catalog[0], id: "nature", sku: "nature_pack", title: "Nature photo pack", priceCents: 2500 },
    ];
    assert.equal(resolveCatalogSku("pics", twoPacks), null);

  });

  it("isolated drafts stay isolated until publish", () => {
    const world = createWorld();
    const draft = submitBrief(world, "Northlight");
    assert.equal(draft.isolated, true);
  });
});
