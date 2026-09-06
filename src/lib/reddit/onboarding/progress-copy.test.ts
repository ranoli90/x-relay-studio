import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { progressBody, progressEventCopy, progressTitle, type ProgressCopyJob } from "./progress-copy.ts";

function job(over: Partial<ProgressCopyJob> = {}): ProgressCopyJob {
  return {
    status: "draft",
    mode: "assisted",
    intent: "create",
    step: "consent",
    waitReason: "Making this Reddit account.",
    expectedUsername: "relayabcd1234",
    ...over,
  };
}

describe("reddit progress copy", () => {
  it("does not claim automation is in progress for a draft create", () => {
    const stuck = job();
    assert.equal(progressTitle(stuck), "Making this Reddit account.");
    assert.match(progressBody(stuck, "batch_queued"), /Open Reddit and create/);
    assert.doesNotMatch(progressBody(stuck, "batch_queued"), /in progress|paused|in control/i);
  });

  it("tells the owner to create then continue after a manual handoff", () => {
    const handed = job({
      status: "waiting_external",
      mode: "manual",
      step: "create_account",
      waitReason: "Create this Reddit account.",
    });
    assert.equal(progressTitle(handed), "Create this Reddit account.");
    assert.match(progressBody(handed, "handoff_manual"), /username you used/);
    assert.equal(
      progressEventCopy("handoff_manual"),
      "This desk is not filling the form. Create the account on Reddit, then continue.",
    );
  });

  it("keeps automation language only while the worker is running", () => {
    const running = job({
      status: "running",
      mode: "assisted",
      step: "create_account",
      waitReason: null,
    });
    assert.match(progressBody(running), /Filling supported fields/);
    assert.equal(progressTitle(running), "Working through supported steps");
  });

  it("does not surface captcha or tick-the-box wait reasons as the title", () => {
    const gated = job({
      status: "needs_user",
      waitReason: "Complete the security check (CAPTCHA) on Reddit.",
    });
    assert.equal(progressTitle(gated), "Create this Reddit account.");
    assert.doesNotMatch(progressTitle(gated), /captcha|tick|agreement/i);
    assert.doesNotMatch(progressBody(gated), /captcha|tick the/i);
  });
});
