import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  USER_SEND_BURST,
  USER_SEND_BURST_MS,
  USER_SEND_DAY,
  USER_SEND_PER_MIN,
} from "./rate.server.ts";

describe("telegram user send caps", () => {
  it("stays under freeze-safe user send limits", () => {
    assert.equal(USER_SEND_PER_MIN, 20);
    assert.equal(USER_SEND_BURST, 8);
    assert.equal(USER_SEND_BURST_MS, 15 * 60 * 1000);
    assert.equal(USER_SEND_DAY, 80);
    assert.ok(USER_SEND_PER_MIN < 60);
    assert.ok(USER_SEND_BURST * 4 <= USER_SEND_DAY);
  });
});
