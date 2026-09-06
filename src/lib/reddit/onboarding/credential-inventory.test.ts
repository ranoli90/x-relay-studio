import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleInventorySummary,
  classifyEnvelopeMetadata,
  envelopeKindSql,
  envelopePrefixSql,
  summaryLooksSafe,
  emptyInventorySummary,
} from "./credential-inventory.ts";
import { encryptV1, encryptV2 } from "./vault.ts";

describe("RC-042 credential inventory metadata", () => {
  it("classifies plaintext, v1, v2, corrupt, and empty without returning the blob", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "inventory-test-key-not-a-secret-store";
    const aad = { userId: "u1", recordId: "r1", purpose: "oauth_revocation_material" };
    const v1 = encryptV1("legacy-refresh-token-value");
    const v2 = encryptV2("scoped-revocation-material", aad);
    const plaintext = "reddit-refresh-token-plain";

    const empty = classifyEnvelopeMetadata("");
    assert.equal(empty.kind, "empty");
    assert.equal(empty.prefix, "none");

    const plain = classifyEnvelopeMetadata(plaintext);
    assert.equal(plain.kind, "non_envelope");
    assert.equal(plain.prefix, "none");
    assert.ok(!JSON.stringify(plain).includes(plaintext));

    const v1Meta = classifyEnvelopeMetadata(v1);
    assert.equal(v1Meta.kind, "v1");
    assert.equal(v1Meta.prefix, "v1");
    assert.equal(v1Meta.partCount, 4);
    assert.ok(!JSON.stringify(v1Meta).includes(v1));

    const v2Meta = classifyEnvelopeMetadata(v2);
    assert.equal(v2Meta.kind, "v2");
    assert.equal(v2Meta.prefix, "v2");
    assert.equal(v2Meta.partCount, 5);
    assert.ok(!JSON.stringify(v2Meta).includes(v2));

    const corrupt = classifyEnvelopeMetadata("v1.not.enough");
    assert.equal(corrupt.kind, "malformed_envelope");
    assert.equal(corrupt.prefix, "v1");
    assert.equal(JSON.stringify(corrupt).includes("v1.not.enough"), false);
  });

  it("does not treat a missing key as a reason to print ciphertext", () => {
    const blob = "v1.aaaa.bbbb.cccc";
    const meta = classifyEnvelopeMetadata(blob);
    assert.equal(meta.kind, "v1");
    assert.deepEqual(Object.keys(meta).sort(), [
      "kind",
      "length",
      "lengthBucket",
      "partCount",
      "prefix",
    ]);
  });

  it("SQL helpers never select the secret column as a value", () => {
    const kind = envelopeKindSql("client_secret");
    const prefix = envelopePrefixSql("refresh_token");
    assert.equal(kind.includes("select client_secret"), false);
    assert.match(kind, /split_part\(client_secret/);
    assert.match(prefix, /in \('v1', 'v2'\)/);
    assert.match(prefix, /else 'none'/);
  });

  it("summary asks operators to reconnect non-envelope rows and stays dry-run", () => {
    const summary = assembleInventorySummary(
      [
        {
          source: "reddit_accounts.refresh_token",
          kind: "non_envelope",
          prefix: "none",
          partCount: 1,
          lengthBucket: "33-128",
          count: 2,
        },
        {
          source: "reddit_accounts.refresh_token",
          kind: "v1",
          prefix: "v1",
          partCount: 4,
          lengthBucket: "129-512",
          count: 5,
        },
        {
          source: "reddit_secret_entries.ciphertext",
          kind: "malformed_envelope",
          prefix: "v2",
          partCount: 3,
          lengthBucket: "1-32",
          count: 1,
        },
      ],
      { redditIdGroups: 0, extraRows: 0 },
    );
    assert.equal(summary.dryRun, true);
    assert.equal(summary.reconnectRequired.nonEnvelope, 2);
    assert.equal(summary.reconnectRequired.malformedEnvelope, 1);
    assert.equal(summary.totals.v1, 5);
    assert.equal(summaryLooksSafe(summary), true);
  });

  it("skipped inventory still exits as a dry-run JSON object", () => {
    const skipped = emptyInventorySummary("DATABASE_URL unset", true);
    assert.equal(skipped.dryRun, true);
    assert.equal(skipped.skipped, true);
    assert.equal(summaryLooksSafe(skipped), true);
  });
});
