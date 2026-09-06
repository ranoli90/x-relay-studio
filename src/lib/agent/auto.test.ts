import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideAutoSend, type DecideAutoSendInput } from "./auto.ts";

function input(extra: Partial<DecideAutoSendInput> = {}): DecideAutoSendInput {
  return {
    personaAutoSend: true,
    goldAllowed: true,
    quiet: false,
    takeover: false,
    workflow: "W5_DAY_ARC",
    dropped: false,
    killed: false,
    bubbleCount: 1,
    safetyVerdict: "allow",
    ...extra,
  };
}

describe("decideAutoSend", () => {
  it("gold off still auto-sends", () => {
    assert.equal(decideAutoSend(input({ goldAllowed: false })), true);
  });

  it("quiet does not block autopilot", () => {
    assert.equal(decideAutoSend(input({ quiet: true })), true);
  });

  it("takeover", () => {
    assert.equal(decideAutoSend(input({ takeover: true })), false);
  });

  it("W6 always draft", () => {
    assert.equal(decideAutoSend(input({ workflow: "W6_CLOSE_NOW" })), false);
  });

  it("W5 auto when enabled", () => {
    assert.equal(decideAutoSend(input({ workflow: "W5_DAY_ARC" })), true);
  });

  it("kill", () => {
    assert.equal(decideAutoSend(input({ killed: true })), false);
    assert.equal(decideAutoSend(input({ safetyVerdict: "kill", workflow: "W15_HANDOFF" })), false);
  });

  it("dropped", () => {
    assert.equal(decideAutoSend(input({ dropped: true })), false);
  });

  it("0 bubbles", () => {
    assert.equal(decideAutoSend(input({ bubbleCount: 0 })), false);
  });

  it("W15", () => {
    assert.equal(decideAutoSend(input({ workflow: "W15_HANDOFF" })), false);
  });

  it("W10 and W16 auto when enabled", () => {
    assert.equal(decideAutoSend(input({ workflow: "W10_AFTERCARE" })), true);
    assert.equal(decideAutoSend(input({ workflow: "W16_QUEUE" })), true);
  });

  it("persona switch off still auto-sends", () => {
    assert.equal(decideAutoSend(input({ personaAutoSend: false })), true);
  });
});
