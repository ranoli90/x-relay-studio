import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePhotoPeer } from "./photo-peer.ts";

describe("parsePhotoPeer", () => {
  it("accepts numeric Telegram ids", () => {
    assert.equal(parsePhotoPeer("6760046139"), "6760046139");
    assert.equal(parsePhotoPeer("-1001234567890"), "-1001234567890");
    assert.equal(parsePhotoPeer(" 42 "), "42");
  });

  it("rejects empty, oversize, and dummy values", () => {
    assert.equal(parsePhotoPeer(null), null);
    assert.equal(parsePhotoPeer(""), null);
    assert.equal(parsePhotoPeer("-"), null);
    assert.equal(parsePhotoPeer("0"), null);
    assert.equal(parsePhotoPeer("-0"), null);
    assert.equal(parsePhotoPeer("00"), null);
    assert.equal(parsePhotoPeer("abc"), null);
    assert.equal(parsePhotoPeer("1".repeat(41)), null);
    assert.equal(parsePhotoPeer("12/../etc"), null);
  });
});
