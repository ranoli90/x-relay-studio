import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashWebhookSecret,
  looksHashedWebhookSecret,
  webhookSecretMatches,
} from "./webhook-secret.ts";

describe("webhookSecretMatches", () => {
  it("accepts a hashed store", () => {
    const raw = "telegram-header-token";
    const stored = hashWebhookSecret(raw);
    assert.equal(looksHashedWebhookSecret(stored), true);
    assert.equal(webhookSecretMatches(raw, stored), true);
    assert.equal(webhookSecretMatches("nope", stored), false);
  });

  it("still accepts a legacy plaintext store", () => {
    const raw = "legacy-plain";
    assert.equal(looksHashedWebhookSecret(raw), false);
    assert.equal(webhookSecretMatches(raw, raw), true);
    assert.equal(webhookSecretMatches(raw, "other"), false);
  });
});
