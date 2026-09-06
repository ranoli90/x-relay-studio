import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyTransportResult, isSentConfirmed } from "./outbox.ts";
import { confirmedTranscript } from "./history.ts";
import { tryDispatchAutoSend } from "../agent/dispatch.server.ts";
import { decideAgentSendPath } from "../telegram/agent-send.server.ts";
import {
  CONFIRMED_AI_ORIGIN,
  HUMAN_MANUAL_ORIGIN,
  applyManualOutboundMirror,
  createMemoryAgentStore,
  decideIngressCreditBurn,
  decideManualOutboundMirror,
  fairHistoryChats,
  preSendFence,
  type AgentTransportRow,
  type MirroredAgentRow,
} from "./mirror.ts";

describe("XR-011 manual Telegram outbound mirror", () => {
  it("upserts one persona/sent/human_manual row for a from_self observation", () => {
    const store = createMemoryAgentStore();
    const first = store.observe({
      userId: "u1",
      threadId: "thr_1",
      fromSelf: true,
      body: "I'll take it from here",
      telegramMessageId: 101,
    });
    assert.equal(first.decision.action, "upsert");
    if (first.decision.action !== "upsert") return;
    assert.equal(first.decision.origin, HUMAN_MANUAL_ORIGIN);
    assert.equal(first.decision.actionable, false);
    assert.equal(first.row?.role, "persona");
    assert.equal(first.row?.status, "sent");
    assert.equal(first.row?.transportMessageId, "101");
    assert.equal(store.rows.length, 1);
  });

  it("deduplicates by user/thread/transport_message_id", () => {
    const store = createMemoryAgentStore();
    const input = {
      userId: "u1",
      threadId: "thr_1",
      fromSelf: true as const,
      body: "same bubble",
      telegramMessageId: 202,
    };
    assert.equal(store.observe(input).decision.action, "upsert");
    const again = store.observe(input);
    assert.equal(again.decision.action, "skip");
    if (again.decision.action !== "skip") return;
    assert.equal(again.decision.reason, "already_mirrored");
    assert.equal(store.rows.length, 1);
  });

  it("skips an agent echo that already has the telegram id on agent_messages", () => {
    const existing: AgentTransportRow[] = [
      {
        userId: "u1",
        threadId: "thr_1",
        transportMessageId: "303",
        origin: CONFIRMED_AI_ORIGIN,
        role: "persona",
      },
    ];
    const decision = decideManualOutboundMirror({
      fromSelf: true,
      telegramMessageId: 303,
      existing,
      userId: "u1",
      threadId: "thr_1",
    });
    assert.deepEqual(decision, { action: "skip", reason: "agent_echo" });
    const store: MirroredAgentRow[] = [];
    const applied = applyManualOutboundMirror(
      store,
      {
        userId: "u1",
        threadId: "thr_1",
        fromSelf: true,
        body: "echo of auto send",
        telegramMessageId: 303,
      },
      existing,
    );
    assert.equal(applied.row, null);
    assert.equal(store.length, 0);
  });

  it("does not queue inbound or from_self without a transport id", () => {
    assert.deepEqual(
      decideManualOutboundMirror({
        fromSelf: false,
        telegramMessageId: 1,
        existing: [],
        userId: "u1",
        threadId: "thr_1",
      }),
      { action: "skip", reason: "not_from_self" },
    );
    assert.deepEqual(
      decideManualOutboundMirror({
        fromSelf: true,
        telegramMessageId: null,
        existing: [],
        userId: "u1",
        threadId: "thr_1",
      }),
      { action: "skip", reason: "no_transport_id" },
    );
  });

  it("imports historical from_self as transcript, not actionable", () => {
    const store = createMemoryAgentStore();
    const hit = store.observe({
      userId: "u1",
      threadId: "thr_1",
      fromSelf: true,
      body: "old answer from last month",
      telegramMessageId: 404,
      createdAt: "2026-08-01T00:00:00.000Z",
      watermark: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(hit.decision.action, "upsert");
    if (hit.decision.action !== "upsert") return;
    assert.equal(hit.decision.historical, true);
    assert.equal(hit.decision.actionable, false);
    assert.equal(hit.row?.origin, HUMAN_MANUAL_ORIGIN);
  });

  it("puts the manual reply in confirmed context exactly once", () => {
    const store = createMemoryAgentStore();
    store.observe({
      userId: "u1",
      threadId: "thr_1",
      fromSelf: true,
      body: "human answered",
      telegramMessageId: 505,
    });
    store.observe({
      userId: "u1",
      threadId: "thr_1",
      fromSelf: true,
      body: "human answered",
      telegramMessageId: 505,
    });
    const transcript = confirmedTranscript([
      { role: "fan", body: "how much?", status: "sent", origin: "observed_partner" },
      ...store.rows,
    ]);
    assert.deepEqual(transcript, [
      { role: "fan", body: "how much?" },
      { role: "persona", body: "human answered" },
    ]);
  });
});

describe("XR-026 pre-send fence", () => {
  it("fails closed on emergencyStop, takeover, and optOut when provided", () => {
    assert.deepEqual(preSendFence({ emergencyStop: true }), { allow: false, reason: "emergency_stop" });
    assert.deepEqual(preSendFence({ takeover: true }), { allow: false, reason: "takeover" });
    assert.deepEqual(preSendFence({ optOut: true }), { allow: false, reason: "opt_out" });
    assert.deepEqual(preSendFence({}), { allow: true });
    assert.deepEqual(preSendFence({ emergencyStop: false, takeover: false, optOut: false }), { allow: true });
  });

  it("tryDispatchAutoSend returns fail before loading transport when fenced", async () => {
    const stop = await tryDispatchAutoSend({
      userId: "u1",
      peer: "42",
      body: "hi",
      agentName: "Maya",
      emergencyStop: true,
    });
    assert.deepEqual(stop, { status: "fail", error: "emergency_stop" });
    const takeover = await tryDispatchAutoSend({
      userId: "u1",
      peer: "42",
      body: "hi",
      agentName: "Maya",
      takeover: true,
    });
    assert.deepEqual(takeover, { status: "fail", error: "takeover" });
    const opt = await tryDispatchAutoSend({
      userId: "u1",
      peer: "42",
      body: "hi",
      agentName: "Maya",
      optOut: true,
    });
    assert.deepEqual(opt, { status: "fail", error: "opt_out" });
  });

  it("does not mark not_live as sent", () => {
    const live = decideAgentSendPath({
      account: { preview: true },
      session: { session_enc: "enc", auth_dead: false },
      peerId: "42",
      peerKind: "user",
      accessHash: "99",
      chatKind: "user",
    });
    assert.equal(live, "not_live");
    const classified = classifyTransportResult({ ok: false, reason: "not_live" });
    assert.equal(classified.kind, "not_live");
    assert.equal(isSentConfirmed(classified), false);
    const falseOk = classifyTransportResult({ ok: true, status: "not_live" });
    assert.equal(falseOk.kind, "not_live");
    assert.equal(isSentConfirmed(falseOk), false);
  });
});

describe("XR-039 credits before generation", () => {
  it("skips burn for held / killed / not auto, even with credits", () => {
    const held = decideIngressCreditBurn({ auto: false, killed: false }, 3);
    assert.equal(held.shouldBurn, false);
    assert.equal(held.event.humanOnly, true);
    assert.equal(held.event.failedModel, false);
    assert.equal(held.event.alreadyBilled, false);

    const killed = decideIngressCreditBurn({ auto: false, killed: true }, 3);
    assert.equal(killed.shouldBurn, false);
    assert.equal(killed.event.safetyKilled, true);
  });

  it("burns only on confirmed auto send", () => {
    const auto = decideIngressCreditBurn({ auto: true, killed: false }, 2);
    assert.equal(auto.shouldBurn, true);
    assert.equal(auto.event.humanOnly, false);
    assert.equal(auto.event.availableCredits, 2);
    assert.equal(auto.event.failedModel, false);
  });

  it("zero credits still skip burn and do not set failedModel", () => {
    const zero = decideIngressCreditBurn({ auto: false, killed: false }, 0);
    assert.equal(zero.shouldBurn, false);
    assert.equal(zero.event.failedModel, false);
    assert.equal(zero.event.humanOnly, true);
    assert.equal(zero.event.availableCredits, 0);
  });
});

describe("XR-041 fair history set", () => {
  it("widens to a small bounded set and stays zero when skipDialogs", () => {
    assert.equal(fairHistoryChats(false), 4);
    assert.equal(fairHistoryChats(true), 0);
  });
});
