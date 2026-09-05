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
  it("has four required checks and one optional", () => {
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
