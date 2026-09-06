import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptSecretStrict,
  decryptV2,
  encryptV1,
  encryptV2,
  SecretDecryptError,
  hashIdempotency,
  maskEmail,
} from "./vault.ts";
import { sensitiveCommandGuard } from "./schemas.ts";

describe("vault", () => {
  it("round-trips v2 with associated data", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-vault-v2-only";
    const aad = { userId: "u1", recordId: "r1", purpose: "signup_email" };
    const blob = encryptV2("secret-value", aad);
    assert.equal(decryptV2(blob, aad), "secret-value");
    assert.throws(
      () => decryptV2(blob, { ...aad, userId: "u2" }),
      SecretDecryptError,
    );
  });

  it("does not treat ciphertext as plaintext", () => {
    delete process.env.SECRETS_ALLOW_LEGACY_PLAINTEXT;
    assert.throws(() => decryptSecretStrict("not-an-envelope"), SecretDecryptError);
    const v1 = encryptV1("hello");
    assert.equal(decryptSecretStrict(v1), "hello");
  });

  it("masks email", () => {
    assert.equal(maskEmail("alex@example.com"), "a•••@example.com");
  });

  it("scopes idempotency hashes", () => {
    assert.notEqual(
      hashIdempotency("a", "start", "k"),
      hashIdempotency("b", "start", "k"),
    );
  });

  it("rejects otp or password in a command payload", () => {
    const parsed = sensitiveCommandGuard.safeParse({ otp: "123456" });
    assert.equal(parsed.success, false);
    const ok = sensitiveCommandGuard.safeParse({ expectedUsername: "alice" });
    assert.equal(ok.success, true);
  });
});
