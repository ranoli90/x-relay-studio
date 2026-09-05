import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  availableCredits,
  burnOrder,
  decideBurn,
  expireRefills,
  release,
  reserveAndCommit,
  reserveOne,
  takeOne,
  type BurnEvent,
  type Lot,
} from "./credits.ts";

const now = Date.parse("2026-09-05T16:00:00.000Z");

function lot(partial: Partial<Lot> & { id: string }): Lot {
  return {
    kind: "topup",
    remaining: 10,
    expiresAt: null,
    ...partial,
  };
}

const work: BurnEvent = {
  safetyKilled: false,
  parked: false,
  takeoverNoModel: false,
  alreadyBilled: false,
  aftercare: false,
  failedModel: false,
  humanOnly: false,
  availableCredits: 3,
};

describe("decideBurn", () => {
  it("burns exactly once on first write after safety and triage", () => {
    assert.deepEqual(decideBurn(work), { burn: true });
  });

  it("does not burn killed safety threads", () => {
    assert.deepEqual(decideBurn({ ...work, safetyKilled: true }), { burn: false, reason: "killed" });
  });

  it("does not burn parked or takeover-with-no-model", () => {
    assert.equal(decideBurn({ ...work, parked: true }).burn, false);
    assert.equal(decideBurn({ ...work, takeoverNoModel: true }).burn, false);
  });

  it("does not burn aftercare or a second inbound on an already-billed thread", () => {
    assert.deepEqual(decideBurn({ ...work, alreadyBilled: true }), {
      burn: false,
      reason: "already_billed",
    });
    assert.deepEqual(decideBurn({ ...work, aftercare: true }), { burn: false, reason: "aftercare" });
  });

  it("does not burn failed model calls or human-only sends", () => {
    assert.equal(decideBurn({ ...work, failedModel: true }).burn, false);
    assert.equal(decideBurn({ ...work, humanOnly: true }).burn, false);
  });

  it("does not go negative at zero credits", () => {
    assert.deepEqual(decideBurn({ ...work, availableCredits: 0 }), {
      burn: false,
      reason: "no_credits",
    });
  });
});

describe("lots", () => {
  it("burns refill first, soonest expiry, then top-ups", () => {
    const lots = [
      lot({ id: "t1", kind: "topup", remaining: 4 }),
      lot({ id: "r2", kind: "refill", remaining: 2, expiresAt: "2026-10-01T00:00:00.000Z" }),
      lot({ id: "r1", kind: "refill", remaining: 5, expiresAt: "2026-09-20T00:00:00.000Z" }),
    ];
    assert.deepEqual(
      burnOrder(lots, now).map((l) => l.id),
      ["r1", "r2", "t1"],
    );
    const once = takeOne(lots, now);
    assert.equal(once.took?.id, "r1");
    assert.equal(once.lots.find((l) => l.id === "r1")?.remaining, 4);
  });

  it("ignores expired refill remainder (monthly unused do not roll)", () => {
    const lots = [
      lot({ id: "r", kind: "refill", remaining: 80, expiresAt: "2026-09-01T00:00:00.000Z" }),
      lot({ id: "t", kind: "topup", remaining: 3 }),
    ];
    assert.equal(availableCredits(lots, now), 3);
    const expired = expireRefills(lots, now);
    assert.equal(expired.find((l) => l.id === "r")?.remaining, 0);
    assert.equal(expired.find((l) => l.id === "t")?.remaining, 3);
  });

  it("takeOne is a no-op when empty so concurrent billed_at can sit at zero", () => {
    const empty = takeOne([], now);
    assert.equal(empty.took, null);
    assert.deepEqual(empty.lots, []);
  });
});

describe("F09 reserveAndCommit / release", () => {
  const lots = [
    lot({ id: "r1", kind: "refill", remaining: 5, expiresAt: "2026-09-20T00:00:00.000Z" }),
    lot({ id: "t1", kind: "topup", remaining: 4 }),
  ];

  it("failed model work does not reserve or burn a lot", () => {
    const result = reserveAndCommit(lots, { ...work, failedModel: true }, now);
    assert.equal(result.hold, null);
    assert.equal(result.decision.burn, false);
    if (!result.decision.burn) assert.equal(result.decision.reason, "failed_model");
    assert.equal(result.lots.find((l) => l.id === "r1")?.remaining, 5);
    assert.equal(result.lots.find((l) => l.id === "t1")?.remaining, 4);
  });

  it("killed / parked / human-only / aftercare never hold a lot", () => {
    for (const event of [
      { ...work, safetyKilled: true },
      { ...work, parked: true },
      { ...work, humanOnly: true },
      { ...work, aftercare: true },
    ] satisfies BurnEvent[]) {
      const result = reserveAndCommit(lots, event, now);
      assert.equal(result.hold, null);
      assert.equal(result.lots.find((l) => l.id === "r1")?.remaining, 5);
    }
  });

  it("reserved lots release on failure and restore remaining", () => {
    const reserved = reserveOne(lots, now);
    assert.ok(reserved.hold);
    assert.equal(reserved.hold?.lotId, "r1");
    assert.equal(reserved.lots.find((l) => l.id === "r1")?.remaining, 4);
    const restored = release(reserved.lots, reserved.hold!);
    assert.equal(restored.find((l) => l.id === "r1")?.remaining, 5);
    assert.equal(restored.find((l) => l.id === "t1")?.remaining, 4);
  });

  it("commit keeps the decrement after successful model work", () => {
    const result = reserveAndCommit(lots, work, now);
    assert.equal(result.decision.burn, true);
    assert.equal(result.hold?.lotId, "r1");
    assert.equal(result.lots.find((l) => l.id === "r1")?.remaining, 4);
  });

  it("failed model still does not burn even when the event claims zero credits", () => {
    const result = reserveAndCommit(lots, { ...work, failedModel: true, availableCredits: 0 }, now);
    assert.equal(result.hold, null);
    if (!result.decision.burn) assert.equal(result.decision.reason, "failed_model");
    assert.equal(result.lots.find((l) => l.id === "r1")?.remaining, 5);
  });

  it("uses live lot remaining, not a stale event.availableCredits of 0", () => {
    const result = reserveAndCommit(lots, { ...work, availableCredits: 0 }, now);
    assert.equal(result.decision.burn, true);
    assert.equal(result.hold?.lotId, "r1");
    assert.equal(result.lots.find((l) => l.id === "r1")?.remaining, 4);
  });
});
