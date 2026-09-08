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
  return { ...defaultFlags(), automationMode: "approved_auto", ...extra };
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
    assert.equal(result.status, "canceled");
    assert.equal(result.uncertainReason, "emergency_stop");
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
      assert.equal(result.status, "canceled", JSON.stringify(change));
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
});
