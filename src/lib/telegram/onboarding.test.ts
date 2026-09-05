import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  helloDeepLink,
  maskBotToken,
  notesChatId,
  parseBotToken,
  parseStartPayload,
} from "./bot-token.ts";
import {
  emptyCheckResults,
  parseChecksJson,
  requiredChecksPassed,
  TELEGRAM_CHECKS,
} from "./checks.ts";
import { decryptSecret, encryptSecret } from "./crypto.server.ts";
import { TELEGRAM_APP_FORM, isUnsafePlatform, titleLooksOfficial } from "./app-form.ts";
import { normalizePhone, parseApiHash, parseApiId } from "./phone.ts";

describe("bot token", () => {
  it("accepts a BotFather-shaped key", () => {
    const token = "123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const parsed = parseBotToken(token);
    assert.equal(parsed?.botId, 123456789);
    assert.equal(maskBotToken(token), "123456789:••••xxxx");
  });

  it("rejects junk", () => {
    assert.equal(parseBotToken("not-a-key"), null);
    assert.equal(parseBotToken("12:short"), null);
  });

  it("builds a hello link and parses /start", () => {
    assert.equal(
      helloDeepLink("my_helper_bot", "abc123"),
      "https://t.me/my_helper_bot?start=abc123",
    );
    assert.equal(parseStartPayload("/start abc123"), "abc123");
    assert.equal(parseStartPayload("/start@my_helper_bot abc123"), "abc123");
    assert.equal(parseStartPayload("hello"), null);
    assert.equal(notesChatId("user-1"), "notes_user-1");
  });
});

describe("checks catalog", () => {
  it("has four required checks and one optional OpenRouter check", () => {
    assert.equal(TELEGRAM_CHECKS.filter((c) => c.required).length, 4);
    assert.equal(TELEGRAM_CHECKS.filter((c) => !c.required).length, 1);
    assert.equal(requiredChecksPassed(emptyCheckResults()), false);
    const passed = emptyCheckResults().map((row) =>
      TELEGRAM_CHECKS.find((m) => m.id === row.id)?.required ? { ...row, ok: true } : row,
    );
    assert.equal(requiredChecksPassed(passed), true);
    assert.equal(parseChecksJson("{}").length, TELEGRAM_CHECKS.length);
  });
});

describe("credential crypto", () => {
  it("round-trips a helper key", () => {
    const token = "123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const blob = encryptSecret(token);
    assert.equal(blob.startsWith("v1."), true);
    assert.equal(blob.includes(token), false);
    assert.equal(decryptSecret(blob), token);
  });
});

describe("phone and app numbers", () => {
  it("normalizes E.164", () => {
    assert.equal(normalizePhone("+1 (555) 123-4567"), "+15551234567");
    assert.equal(normalizePhone("15551234567"), "+15551234567");
    assert.equal(normalizePhone("123"), null);
  });

  it("parses api id and hash", () => {
    assert.equal(parseApiId("123456"), 123456);
    assert.equal(parseApiId("12"), null);
    assert.equal(parseApiHash("0123456789abcdef0123456789abcdef"), "0123456789abcdef0123456789abcdef");
    assert.equal(parseApiHash("nope"), null);
  });
});

describe("my.telegram.org form values", () => {
  it("does not impersonate Telegram", () => {
    assert.equal(titleLooksOfficial(TELEGRAM_APP_FORM.title), false);
    assert.equal(titleLooksOfficial("Telegram"), true);
    assert.equal(TELEGRAM_APP_FORM.platform, "Web");
    assert.equal(isUnsafePlatform("Android"), true);
    assert.equal(isUnsafePlatform("Web"), false);
    assert.match(TELEGRAM_APP_FORM.shortName, /^[A-Za-z0-9]{5,32}$/);
  });
});
