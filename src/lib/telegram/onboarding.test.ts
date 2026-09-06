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
  stampCheck,
  TELEGRAM_CHECKS,
} from "./checks.ts";
import { decryptSecret, encryptSecret } from "./crypto.server.ts";
import { TELEGRAM_APP_FORM, isUnsafePlatform, titleLooksOfficial } from "./app-form.ts";
import { mergeOnboardingStep, parseOnboardingDraft } from "./onboarding-draft.ts";
import { normalizePhone, parseApiHash, parseApiId } from "./phone.ts";
import { parsedStartLogin } from "./validate.ts";

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
  it("has three required checks; watching is optional so it is not a gate", () => {
    assert.equal(TELEGRAM_CHECKS.filter((c) => c.required).length, 3);
    assert.equal(TELEGRAM_CHECKS.filter((c) => !c.required).length, 2);
    assert.equal(TELEGRAM_CHECKS.find((c) => c.id === "watching_on")?.required, false);
    assert.equal(requiredChecksPassed(emptyCheckResults()), false);
    const passed = emptyCheckResults().map((row) =>
      TELEGRAM_CHECKS.find((m) => m.id === row.id)?.required ? { ...row, ok: true } : row,
    );
    assert.equal(requiredChecksPassed(passed), true);
    assert.equal(parseChecksJson("{}").length, TELEGRAM_CHECKS.length);
  });

  it("treats an empty account as a valid chats/messages capability", () => {
    const listed = stampCheck(undefined, {
      ok: true,
      detail: "No chats on this account yet.",
    });
    assert.equal(listed.ok, true);
    assert.ok(listed.lastSuccessAt);
    const flood = stampCheck(
      { id: "chats_visible", ok: true, detail: listed.detail, ranAt: listed.ranAt, lastSuccessAt: listed.lastSuccessAt },
      {
        ok: false,
        detail: "Telegram asked us to wait 17 seconds.",
        terminal: false,
        at: new Date(Date.parse(listed.lastSuccessAt ?? listed.ranAt ?? 0) + 1000).toISOString(),
      },
    );
    assert.equal(flood.ok, true);
    assert.equal(flood.lastSuccessAt, listed.lastSuccessAt);
    assert.notEqual(flood.lastAttemptAt, flood.lastSuccessAt);
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
    assert.equal(normalizePhone("+1 303 555 0100"), "+13035550100");
    assert.equal(normalizePhone("123"), null);
    assert.equal(normalizePhone("3035550100"), null);
  });

  it("parses api id and hash", () => {
    assert.equal(parseApiId("123456"), 123456);
    assert.equal(parseApiId("12"), null);
    assert.equal(parseApiHash("0123456789abcdef0123456789abcdef"), "0123456789abcdef0123456789abcdef");
    assert.equal(parseApiHash("nope"), null);
  });
});

describe("login key precedence", () => {
  const deskStored = {
    apiId: 111111,
    apiHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const desk = {
    phone: "+15551234567",
    apiId: "222222",
    apiHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };

  it("uses the desk's own api_id when posted", () => {
    const parsed = parsedStartLogin(desk, deskStored);
    assert.equal(parsed.apiId, 222222);
    assert.equal(parsed.apiHash, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert.equal(parsed.phone, "+15551234567");
  });

  it("falls back only to keys already stored on this desk", () => {
    const parsed = parsedStartLogin({ phone: "+15551234567" }, deskStored);
    assert.equal(parsed.apiId, 111111);
    assert.equal(parsed.apiHash, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("does not silently reuse another desk's numbers when this desk has none", () => {
    assert.throws(
      () => parsedStartLogin({ phone: "+19998887766" }, null),
      (err: Error) => err.name === "TelegramError",
    );
  });

  it("rejects a login with neither posted nor stored desk keys", () => {
    assert.throws(
      () => parsedStartLogin({ phone: "+15551234567" }, null),
      (err: Error) => err.name === "TelegramError",
    );
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

describe("onboarding draft", () => {
  it("keeps the local app step when the server is still welcome", () => {
    assert.equal(mergeOnboardingStep("welcome", "app"), "app");
    assert.equal(mergeOnboardingStep("code", "app"), "code");
    assert.equal(mergeOnboardingStep("password", "app"), "password");
    const parsed = parseOnboardingDraft({
      step: "app",
      apiId: "123456",
      apiHash: "abc",
      phone: "+15551234567",
    });
    assert.equal(parsed?.step, "app");
    assert.equal(parsed?.apiId, "123456");
    assert.equal(parseOnboardingDraft({ step: "password", apiId: "1", apiHash: "2", phone: "" }), null);
  });
});
