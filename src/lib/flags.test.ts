import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  cronJobsEnabled,
  unofficialXLookupEnabled,
  redditConnectorEnabled,
  studioTickEnabled,
  telegramMtprotoEnabled,
  xAutoPostEnabled,
  openRouterEnabled,
} from "./flags.ts";

const KEYS = [
  "FXTWITTER_ENABLED",
  "TELEGRAM_MTPROTO_ENABLED",
  "REDDIT_ENABLED",
  "CRON_ENABLED",
  "STUDIO_TICK_ENABLED",
  "OPENROUTER_ENABLED",
  "OPENROUTER_API_KEY",
  "VERCEL",
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

describe("unofficialXLookupEnabled", () => {
  it("defaults off when deployed", () => {
    process.env.VERCEL = "1";
    delete process.env.FXTWITTER_ENABLED;
    assert.equal(unofficialXLookupEnabled(), false);
  });

  it("defaults on in local dev", () => {
    delete process.env.VERCEL;
    process.env.NODE_ENV = "test";
    delete process.env.FXTWITTER_ENABLED;
    assert.equal(unofficialXLookupEnabled(), true);
  });

  it("honors an explicit off switch", () => {
    delete process.env.VERCEL;
    process.env.FXTWITTER_ENABLED = "false";
    assert.equal(unofficialXLookupEnabled(), false);
  });

  it("honors an explicit on switch in production", () => {
    process.env.VERCEL = "1";
    process.env.FXTWITTER_ENABLED = "true";
    assert.equal(unofficialXLookupEnabled(), true);
  });
});

describe("other kill switches", () => {
  it("stay on unless set false", () => {
    delete process.env.TELEGRAM_MTPROTO_ENABLED;
    delete process.env.REDDIT_ENABLED;
    delete process.env.CRON_ENABLED;
    delete process.env.STUDIO_TICK_ENABLED;
    assert.equal(telegramMtprotoEnabled(), true);
    assert.equal(redditConnectorEnabled(), true);
    assert.equal(cronJobsEnabled(), true);
    assert.equal(studioTickEnabled(), true);
    process.env.CRON_ENABLED = "off";
    assert.equal(cronJobsEnabled(), false);
    process.env.STUDIO_TICK_ENABLED = "0";
    assert.equal(studioTickEnabled(), false);
  });

  it("openRouter stays off without a key or when killed", () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_ENABLED;
    assert.equal(openRouterEnabled(), false);
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    assert.equal(openRouterEnabled(), true);
    process.env.OPENROUTER_ENABLED = "false";
    assert.equal(openRouterEnabled(), false);
  });
});

describe("X manual queue", () => {
  it("cannot enable auto-post via env", () => {
    process.env.X_AUTOPOST_ENABLED = "true";
    assert.equal(xAutoPostEnabled(), false);
    delete process.env.X_AUTOPOST_ENABLED;
    assert.equal(xAutoPostEnabled(), false);
  });
});
