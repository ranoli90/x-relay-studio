import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNonProcessableInbound, redactForModel } from "./consent.ts";

describe("F03 non-processable inbound", () => {
  it("suppresses Telegram login codes", () => {
    assert.equal(
      isNonProcessableInbound("Your Telegram login code is 12345", "Telegram"),
      true,
    );
  });
  it("suppresses service chat names", () => {
    assert.equal(isNonProcessableInbound("New login from a device", "Telegram"), true);
  });
  it("allows a normal fan message", () => {
    assert.equal(isNonProcessableInbound("hey, you around?", "Alex"), false);
  });
  it("redacts numeric codes for model/log boundaries", () => {
    assert.equal(redactForModel("code 4829101 landed"), "code [code] landed");
  });
});
