import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  cronJobsEnabled,
  unofficialXLookupEnabled,
  redditConnectorEnabled,
  telegramMtprotoEnabled,
} from "./flags.ts";

const KEYS = [
  "FXTWITTER_ENABLED",
  "TELEGRAM_MTPROTO_ENABLED",
  "REDDIT_ENABLED",
  "CRON_ENABLED",
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
    assert.equal(telegramMtprotoEnabled(), true);
    assert.equal(redditConnectorEnabled(), true);
    assert.equal(cronJobsEnabled(), true);
    process.env.CRON_ENABLED = "off";
    assert.equal(cronJobsEnabled(), false);
  });
});
