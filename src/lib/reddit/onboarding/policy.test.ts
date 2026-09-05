import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionAllowed, capabilities, navigationAllowed } from "./policy.ts";
import { REDDIT_SCOPES } from "../types.ts";

describe("capabilities", () => {
  it("never enables post vote or send", () => {
    const caps = capabilities({
      onboardingEnabled: true,
      assistedFlag: true,
      approvalStatus: "approved",
      provider: "fake",
      providerConfigured: true,
    });
    assert.equal(caps.canPost, false);
    assert.equal(caps.canVote, false);
    assert.equal(caps.canSendMessages, false);
    assert.match(REDDIT_SCOPES, /privatemessages/);
  });

  it("keeps manual available without Browserbase", () => {
    const caps = capabilities({
      onboardingEnabled: true,
      assistedFlag: false,
      providerConfigured: false,
    });
    assert.equal(caps.canContinueManualSetup, true);
    assert.equal(caps.canStartAssistedSignup, false);
  });

  it("client cannot approve by assertion", () => {
    const caps = capabilities({ approvalStatus: "approved_by_client" as "approved" });
    assert.equal(caps.canStartAssistedSignup, false);
  });

  it("rejects lookalike navigation and forbidden methods", () => {
    assert.equal(navigationAllowed("https://reddlt.com/register"), false);
    assert.equal(navigationAllowed("javascript:alert(1)"), false);
    assert.equal(navigationAllowed("https://www.reddit.com/register"), true);
    assert.equal(actionAllowed({ method: "evaluate" }, "create_account").ok, false);
    assert.equal(actionAllowed({ method: "solve_captcha" }, "create_account").ok, false);
    assert.equal(actionAllowed({ method: "fill", fieldLabel: "username" }, "create_account").ok, true);
  });
});
