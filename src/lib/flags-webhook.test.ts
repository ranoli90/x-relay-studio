import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { sha256Hex, timingSafeEqualString } from "./secrets.ts";

describe("webhook secret hashing", () => {
  it("stores only the sha256 hex of the bearer token", () => {
    const raw = "a".repeat(48);
    const hashed = sha256Hex(raw);
    assert.equal(hashed.length, 64);
    assert.equal(hashed, createHash("sha256").update(raw).digest("hex"));
    assert.notEqual(hashed, raw);
  });

  it("compares hashed values in constant time", () => {
    const raw = "webhook-secret-example";
    const stored = sha256Hex(raw);
    assert.equal(timingSafeEqualString(sha256Hex(raw), stored), true);
    assert.equal(timingSafeEqualString(sha256Hex("other"), stored), false);
    assert.equal(timingSafeEqualString(raw, stored), false);
  });
});
