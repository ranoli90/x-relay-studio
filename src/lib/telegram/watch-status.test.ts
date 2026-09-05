import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floodSecondsLeft, floodWaitLabel, watchIsLocked } from "./watch-status.ts";

describe("watch-status", () => {
  it("treats past floodUntil as unlocked", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    assert.equal(floodSecondsLeft("2000-01-01T00:00:00.000Z", now), 0);
    assert.equal(watchIsLocked({ floodUntil: "2000-01-01T00:00:00.000Z", authDead: false }, now), false);
  });

  it("locks on authDead or future floodUntil", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    assert.equal(watchIsLocked({ authDead: true }, now), true);
    assert.equal(floodWaitLabel("2026-01-01T00:02:00.000Z", now), "2 min");
    assert.equal(watchIsLocked({ floodUntil: "2026-01-01T00:02:00.000Z" }, now), true);
  });
});
