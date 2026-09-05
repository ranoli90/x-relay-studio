import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifyTelegramWidget } from "./widget-hmac.ts";
import { graphemeCount, sliceGraphemes } from "./graphemes.ts";

function sign(payload: Record<string, string>, token: string): string {
  const check = Object.keys(payload)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(token).digest();
  return createHmac("sha256", secret).update(check).digest("hex");
}

describe("telegram widget hmac", () => {
  const token = "123456:test-token";
  const now = 1_700_000_000;

  it("accepts a fresh signed payload", () => {
    const payload: Record<string, string> = {
      id: "42",
      first_name: "Ada",
      auth_date: String(now),
    };
    payload.hash = sign(payload, token);
    const result = verifyTelegramWidget(payload, token, now);
    assert.equal(result.ok, true);
  });

  it("rejects a bad hash", () => {
    const payload = {
      id: "42",
      first_name: "Ada",
      auth_date: String(now),
      hash: "00".repeat(32),
    };
    const result = verifyTelegramWidget(payload, token, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "bad_hash");
  });

  it("rejects a stale auth_date", () => {
    const payload: Record<string, string> = {
      id: "42",
      auth_date: String(now - 90_000),
    };
    payload.hash = sign(payload, token);
    const result = verifyTelegramWidget(payload, token, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "stale");
  });
});

describe("graphemes", () => {
  it("counts and slices by grapheme", () => {
    assert.equal(graphemeCount("hi"), 2);
    assert.equal(sliceGraphemes("abcdef", 3), "abc");
  });
});
