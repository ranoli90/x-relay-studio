import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { actionAllowed, capabilities, navigationAllowed } from "./policy.ts";
import { fixtureOriginAllowlist } from "./config.ts";
import { REDDIT_SCOPES } from "../types.ts";

const ENV_KEYS = [
  "VERCEL",
  "NODE_ENV",
  "REDDIT_ONBOARDING_FIXTURE",
  "REDDIT_ONBOARDING_FIXTURE_PORT",
  "PORT",
  "REDDIT_ASSISTED_SIGNUP_ENABLED",
  "REDDIT_ONBOARDING_ENABLED",
] as const;
const snapshot: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) snapshot[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function enableFixture(port = "8080") {
  delete process.env.VERCEL;
  process.env.NODE_ENV = "test";
  process.env.REDDIT_ONBOARDING_FIXTURE = "true";
  process.env.REDDIT_ONBOARDING_FIXTURE_PORT = port;
  delete process.env.PORT;
}

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

  it("allows assisted only in isolated fixture when the flag is on, never because a client said approved", () => {
    enableFixture();
    process.env.REDDIT_ONBOARDING_ENABLED = "true";
    process.env.REDDIT_ASSISTED_SIGNUP_ENABLED = "true";
    const fixture = capabilities({
      onboardingEnabled: true,
      assistedFlag: true,
      provider: "fake",
      providerConfigured: true,
      assistanceConsent: true,
    });
    assert.equal(fixture.canStartAssistedSignup, true);
    process.env.VERCEL = "1";
    process.env.NODE_ENV = "production";
    const hosted = capabilities({
      onboardingEnabled: true,
      assistedFlag: true,
      provider: "fake",
      providerConfigured: true,
      assistanceConsent: true,
    });
    assert.equal(hosted.canStartAssistedSignup, false);
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

describe("navigation origins and fixture ports", () => {
  it("compares the complete origin including non-default ports", () => {
    assert.equal(navigationAllowed("https://www.reddit.com/register"), true);
    assert.equal(navigationAllowed("https://www.reddit.com:443/register"), true);
    assert.equal(navigationAllowed("https://www.reddit.com:8443/register"), false);
    assert.equal(navigationAllowed("https://old.reddit.com/login"), true);
  });

  it("allows localhost fixtures only when enabled, on the allowlisted origin, and on the fixture path", () => {
    delete process.env.VERCEL;
    process.env.NODE_ENV = "test";
    delete process.env.REDDIT_ONBOARDING_FIXTURE;
    assert.equal(navigationAllowed("http://127.0.0.1:8080/__reddit-onboarding-fixture"), false);
    assert.deepEqual(fixtureOriginAllowlist(), []);

    enableFixture("8080");
    assert.deepEqual(fixtureOriginAllowlist(), ["http://127.0.0.1:8080", "http://localhost:8080"]);
    assert.equal(navigationAllowed("http://127.0.0.1:8080/__reddit-onboarding-fixture"), true);
    assert.equal(navigationAllowed("http://localhost:8080/__reddit-onboarding-fixture/index.html"), true);
    assert.equal(navigationAllowed("http://127.0.0.1:9999/__reddit-onboarding-fixture"), false);
    assert.equal(navigationAllowed("http://127.0.0.1:8080/register"), false);
    assert.equal(navigationAllowed("http://localhost:8080/"), false);
  });
});

describe("action policy clicks, frames, and sensitive fills", () => {
  it("rejects a generic click without an allowlisted target", () => {
    assert.equal(actionAllowed({ method: "click" }, "create_account").ok, false);
    assert.equal(actionAllowed({ method: "click", selector: "#anything" }, "create_account").ok, false);
    assert.equal(actionAllowed({ method: "click", allowedTarget: "continue" }, "create_account").ok, true);
    assert.equal(actionAllowed({ method: "click", fieldLabel: "next" }, "create_account").ok, true);
    assert.equal(actionAllowed({ method: "click", name: "username" }, "create_account").ok, true);
    assert.equal(actionAllowed({ method: "click", name: "email" }, "create_account").ok, true);
  });

  it("never allows owner-only click targets", () => {
    for (const target of ["terms", "oauth", "captcha", "submit-final"]) {
      const result = actionAllowed({ method: "click", allowedTarget: target }, "create_account");
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "CLICK_TARGET_DENIED");
    }
  });

  it("treats password, otp, and code fills as owner-only regardless of step", () => {
    for (const step of ["create_account", "verify_account", "consent"]) {
      assert.equal(actionAllowed({ method: "fill", fieldLabel: "password" }, step).ok, false);
      assert.equal(actionAllowed({ method: "fill", fieldLabel: "otp" }, step).ok, false);
      assert.equal(actionAllowed({ method: "fill", name: "code" }, step).ok, false);
    }
  });

  it("denies actions when the frame origin differs from the page origin", () => {
    const result = actionAllowed(
      { method: "fill", fieldLabel: "username" },
      "create_account",
      { pageOrigin: "https://www.reddit.com", frameOrigin: "https://evil.example" },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FRAME_ORIGIN_DENIED");
  });
});
