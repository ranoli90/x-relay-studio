import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEvent,
  canExecuteCommand,
  irreversibleSubmitBlocked,
  permittedActions,
  TransitionError,
  type MachineJob,
} from "./machine.ts";

function draft(over: Partial<MachineJob> = {}): MachineJob {
  return {
    status: "draft",
    step: "consent",
    version: 1,
    mode: "manual",
    intent: "create",
    creationOutcome: "not_started",
    connectionState: "not_started",
    controlOwner: "none",
    cancelRequested: false,
    submitSideEffect: null,
    ...over,
  };
}

describe("onboarding machine", () => {
  it("rejects an invalid status transition", () => {
    const job = draft({ status: "completed", step: "finish" });
    assert.throws(() => applyEvent(job, { type: "OWNER_STARTS" }), TransitionError);
  });

  it("moves manual start to waiting without a browser", () => {
    const next = applyEvent(draft(), { type: "OWNER_STARTS" });
    assert.equal(next.status, "waiting_external");
    assert.equal(next.step, "create_account");
    assert.equal(next.version, 2);
  });

  it("queues assisted work", () => {
    const next = applyEvent(draft({ mode: "assisted" }), { type: "OWNER_STARTS" });
    assert.equal(next.status, "queued");
    assert.equal(next.step, "session");
  });

  it("does not replay an in-flight submit", () => {
    const job = draft({
      status: "running",
      step: "create_account",
      submitSideEffect: "started",
    });
    assert.equal(irreversibleSubmitBlocked(job), true);
    assert.throws(() => applyEvent(job, { type: "SUBMIT_APPROVED" }), /in flight/i);
  });

  it("lost submit goes to reconciling and cancel does not claim the account is gone", () => {
    const lost = applyEvent(
      draft({ status: "running", step: "create_account" }),
      { type: "SUBMIT_LOST" },
    );
    assert.equal(lost.status, "reconciling");
    assert.equal(lost.creationOutcome, "unknown");
    const cancelled = applyEvent(lost, { type: "OWNER_CANCELS" });
    assert.equal(cancelled.status, "reconciling");
    assert.equal(cancelled.cancelRequested, true);
  });

  it("oauth identity does not auto-enable posting", () => {
    const next = applyEvent(
      draft({ status: "needs_user", step: "oauth" }),
      { type: "OAUTH_INTENDED_IDENTITY" },
    );
    assert.equal(next.step, "health");
    assert.equal(next.connectionState, "pending");
  });

  it("blocks start after cancel request", () => {
    const job = draft({ status: "running", cancelRequested: true });
    assert.equal(canExecuteCommand(job, "start"), false);
    assert.equal(canExecuteCommand(job, "cancel"), true);
  });

  it("hands an assisted job to manual without opening a second job", () => {
    const next = applyEvent(draft({ mode: "assisted", status: "queued", step: "session" }), {
      type: "HANDOFF_TO_MANUAL",
    });
    assert.equal(next.mode, "manual");
    assert.equal(next.status, "waiting_external");
    assert.equal(canExecuteCommand(draft({ mode: "assisted", status: "running" }), "handoff_manual"), true);
    const actions = permittedActions(draft({ mode: "assisted", status: "running", step: "create_account" }), {
      assisted: true,
      oauth: false,
      appReady: false,
    });
    assert.equal(actions.includes("handoff_manual"), true);
  });

  it("queued allocation loss goes to reconciling", () => {
    const lost = applyEvent(draft({ mode: "assisted", status: "queued", step: "session" }), {
      type: "SUBMIT_LOST",
    });
    assert.equal(lost.status, "reconciling");
    assert.equal(lost.creationOutcome, "unknown");
  });

  it("permits cancel and finish-later while waiting", () => {
    const actions = permittedActions(draft({ status: "waiting_external", step: "app_access" }), {
      assisted: false,
      oauth: true,
      appReady: true,
    });
    assert.equal(actions.includes("cancel"), true);
    assert.equal(actions.includes("start_oauth"), true);
  });

  it("lets the owner take control from needs_user", () => {
    const taken = applyEvent(draft({ status: "needs_user", step: "verify_account", controlOwner: "none" }), {
      type: "OWNER_TAKES_CONTROL",
    });
    assert.equal(taken.controlOwner, "user");
    assert.equal(taken.status, "needs_user");
    assert.equal(
      canExecuteCommand(draft({ status: "needs_user", step: "verify_account", controlOwner: "none" }), "request_takeover"),
      true,
    );
  });
});
