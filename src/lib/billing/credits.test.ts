import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { availableCredits, burnOrder, decideBurn, expireRefills, takeOne, type Lot } from "./credits.ts";

const now = Date.parse("2026-09-05T16:00:00.000Z");

function lot(partial: Partial<Lot> & { id: string }): Lot {
  return {
    kind: "topup",
    remaining: 10,
    expiresAt: null,
    ...partial,
  };
}

describe("decideBurn", () => {
  const work = {
    safetyKilled: false,
    parked: false,
    takeoverNoModel: false,
    alreadyBilled: false,
    aftercare: false,
    failedModel: false,
    humanOnly: false,
    availableCredits: 3,
  };

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
