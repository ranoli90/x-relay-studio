import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TelegramError } from "./errors.ts";
import { assertOidcPayload } from "./oidc-claims.ts";
import { isServicePeer, redactPreview, redactSecretText } from "./preview.ts";
import {
  ChatIdSchema,
  ProfileSchema,
  SendSchema,
  parseOrThrow,
  pickCredentialFields,
  safeHttpUrl,
} from "./validate.ts";

describe("safeHttpUrl", () => {
  it("keeps http(s) and drops javascript/data", () => {
    assert.equal(safeHttpUrl("https://cdn.telegram.org/file.jpg"), "https://cdn.telegram.org/file.jpg");
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl("data:text/html,hi"), null);
    assert.equal(safeHttpUrl("https://user:pass@evil.test/x"), null);
    assert.equal(safeHttpUrl(null), null);
  });
});

describe("oidc claims", () => {
  const now = 1_700_000_000;
  const base = {
    nonce: "abc12345nonce",
    iat: now,
    auth_date: now,
    id: 42,
    given_name: "Ada",
    family_name: "Lovelace",
    preferred_username: "@ada",
    picture: "https://cdn.telegram.org/ada.jpg",
  };

  it("accepts a fresh matching nonce", () => {
    const profile = assertOidcPayload(base, "abc12345nonce", now);
    assert.equal(profile.telegramUserId, 42);
    assert.equal(profile.firstName, "Ada");
    assert.equal(profile.username, "ada");
    assert.equal(profile.photoUrl, "https://cdn.telegram.org/ada.jpg");
  });

  it("rejects a missing nonce", () => {
    assert.throws(
      () => assertOidcPayload({ ...base, nonce: undefined }, "abc12345nonce", now),
      TelegramError,
    );
  });

  it("rejects a mismatched nonce", () => {
    assert.throws(() => assertOidcPayload(base, "other-nonce-xx", now), TelegramError);
  });

  it("rejects a stale auth_date", () => {
    assert.throws(
      () => assertOidcPayload({ ...base, auth_date: now - 600, iat: now - 600 }, "abc12345nonce", now),
      TelegramError,
    );
  });
});

describe("input schemas", () => {
  it("accepts a send payload", () => {
    const data = parseOrThrow(SendSchema, { chatId: "notes_dev-user", body: "  hi  " });
    assert.equal(data.body, "hi");
  });

  it("rejects an empty message", () => {
    assert.throws(() => parseOrThrow(SendSchema, { chatId: "notes_dev-user", body: "   " }), TelegramError);
  });

  it("rejects a bad chat id", () => {
    assert.throws(() => parseOrThrow(ChatIdSchema, "../etc"), TelegramError);
  });

  it("requires a first name", () => {
    assert.throws(
      () => parseOrThrow(ProfileSchema, { firstName: " ", lastName: "", about: "" }),
      TelegramError,
    );
  });

  it("whitelists credential columns", () => {
    const picked = pickCredentialFields({ hello_at: "now", checks_json: "{}" });
    assert.equal(picked.hello_at, "now");
    assert.throws(() => pickCredentialFields({ user_id: "x" }), TelegramError);
  });
});

describe("secret redaction", () => {
  it("strips login codes from previews", () => {
    assert.equal(redactPreview("Login code: 21786. Do not give this code"), "Login code. Do not give this code");
    assert.equal(redactSecretText("Login code: 21786"), "Login code");
  });

  it("marks Telegram service peers", () => {
    assert.equal(isServicePeer("777000"), true);
    assert.equal(isServicePeer("42777"), true);
    assert.equal(isServicePeer("6760046139"), false);
  });
});
