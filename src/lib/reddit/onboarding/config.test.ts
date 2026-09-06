import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  onboardingFixtureEnabled,
  redditAssistedSignupEnabled,
  redditBrowserProvider,
  redditDraftingEnabled,
  redditEmailBindingEnabled,
  redditOnboardingEnabled,
  redditPublishEnabled,
  redditRuntimeClass,
  steelConfigured,
  localChromiumAllowed,
} from "./config.ts";

const KEYS = [
  "REDDIT_ONBOARDING_ENABLED",
  "REDDIT_ASSISTED_SIGNUP_ENABLED",
  "REDDIT_DRAFTING_ENABLED",
  "REDDIT_PUBLISH_ENABLED",
  "REDDIT_EMAIL_BINDING_ENABLED",
  "REDDIT_ONBOARDING_FIXTURE",
  "REDDIT_BROWSER_PROVIDER",
  "STEEL_API_URL",
  "STEEL_API_KEY",
  "VERCEL",
  "VERCEL_ENV",
  "NODE_ENV",
] as const;

const snapshot: Record<string, string | undefined> = {};
for (const key of KEYS) snapshot[key] = process.env[key];

afterEach(() => {
  for (const key of KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("reddit onboarding environment defaults", () => {
  it("defaults on locally when not deployed", () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "test";
    delete process.env.REDDIT_ONBOARDING_ENABLED;
    assert.equal(redditOnboardingEnabled(), true);
    assert.equal(redditRuntimeClass(), "local");
  });

  it("defaults on for Vercel preview so Create vs Connect is visible", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.NODE_ENV = "production";
    delete process.env.REDDIT_ONBOARDING_ENABLED;
    assert.equal(redditOnboardingEnabled(), true);
    assert.equal(redditRuntimeClass(), "hosted_preview");
  });

  it("defaults on in production and still honors explicit false", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.NODE_ENV = "production";
    delete process.env.REDDIT_ONBOARDING_ENABLED;
    assert.equal(redditOnboardingEnabled(), true);
    process.env.REDDIT_ONBOARDING_ENABLED = "false";
    assert.equal(redditOnboardingEnabled(), false);
  });

  it("keeps drafting, publish, email binding, assisted signup, and fixture off by default", () => {
    delete process.env.VERCEL;
    process.env.NODE_ENV = "test";
    delete process.env.REDDIT_DRAFTING_ENABLED;
    delete process.env.REDDIT_PUBLISH_ENABLED;
    delete process.env.REDDIT_EMAIL_BINDING_ENABLED;
    delete process.env.REDDIT_ASSISTED_SIGNUP_ENABLED;
    delete process.env.REDDIT_ONBOARDING_FIXTURE;
    assert.equal(redditDraftingEnabled(), false);
    assert.equal(redditPublishEnabled(), false);
    assert.equal(redditEmailBindingEnabled(), false);
    assert.equal(redditAssistedSignupEnabled(), false);
    assert.equal(onboardingFixtureEnabled(), false);
  });

  it("never enables the fixture allowlist on a hosted deployment", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    process.env.REDDIT_ONBOARDING_FIXTURE = "true";
    assert.equal(onboardingFixtureEnabled(), false);
  });

  it("selects steel or local providers and refuses local Chromium on Vercel", () => {
    delete process.env.VERCEL;
    process.env.REDDIT_BROWSER_PROVIDER = "steel";
    process.env.STEEL_API_URL = "http://127.0.0.1:3000";
    assert.equal(redditBrowserProvider(), "steel");
    assert.equal(steelConfigured(), true);
    process.env.REDDIT_BROWSER_PROVIDER = "local";
    assert.equal(redditBrowserProvider(), "local");
    assert.equal(localChromiumAllowed(), true);
    process.env.VERCEL = "1";
    assert.equal(localChromiumAllowed(), false);
  });
});
