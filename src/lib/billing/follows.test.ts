import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  followBindAllowed,
  followDiscountHeld,
  telegramMemberOk,
  verifyFollowMembership,
} from "./follows.ts";

describe("F10 follow membership", () => {
  it("only treats member/admin/creator as Telegram-ok", () => {
    assert.equal(telegramMemberOk("member"), true);
    assert.equal(telegramMemberOk("administrator"), true);
    assert.equal(telegramMemberOk("creator"), true);
    assert.equal(telegramMemberOk("left"), false);
    assert.equal(telegramMemberOk("kicked"), false);
    assert.equal(telegramMemberOk(null), false);
  });

  it("does not let a second desk bind the same external id", () => {
    assert.equal(
      followBindAllowed({
        network: "telegram",
        externalId: "42",
        existingDeskUserId: "desk_a",
        thisDeskUserId: "desk_a",
      }),
      true,
    );
    assert.equal(
      followBindAllowed({
        network: "telegram",
        externalId: "42",
        existingDeskUserId: "desk_a",
        thisDeskUserId: "desk_b",
      }),
      false,
    );
  });

  it("holds the one-time discount while a discounted invoice is open", () => {
    assert.equal(
      followDiscountHeld([{ discountCents: 500, status: "pending" }]),
      true,
    );
    assert.equal(
      followDiscountHeld([{ discountCents: 500, status: "creating" }]),
      true,
    );
    assert.equal(
      followDiscountHeld([{ discountCents: 500, status: "uncertain" }]),
      true,
    );
    assert.equal(
      followDiscountHeld([{ discountCents: 500, status: "paid" }]),
      false,
    );
    assert.equal(
      followDiscountHeld([{ discountCents: 0, status: "pending" }]),
      false,
    );
  });

  it("live-checks Telegram and Discord and fails closed on a left member", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("getChatMember")) {
        return { ok: true, json: async () => ({ ok: true, result: { status: "left" } }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    const result = await verifyFollowMembership({
      telegramUserId: "1",
      discordUserId: "2",
      telegramChatId: "-100",
      telegramBotToken: "bot",
      discordGuildId: "g",
      discordBotToken: "dc",
      fetchImpl,
    });
    assert.equal(result.telegram, false);
    assert.equal(result.verified, false);
  });

  it("requires both live memberships", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("getChatMember")) {
        return { ok: true, json: async () => ({ ok: true, result: { status: "member" } }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    const result = await verifyFollowMembership({
      telegramUserId: "1",
      discordUserId: "2",
      telegramChatId: "-100",
      telegramBotToken: "bot",
      discordGuildId: "g",
      discordBotToken: "dc",
      fetchImpl,
    });
    assert.equal(result.telegram, true);
    assert.equal(result.discord, true);
    assert.equal(result.verified, true);
  });

  it("fails closed when bot tokens or ids are missing and does not call fetch", async () => {
    let called = 0;
    const fetchImpl = async () => {
      called += 1;
      return { ok: true, json: async () => ({}) };
    };
    const result = await verifyFollowMembership({
      telegramUserId: "1",
      discordUserId: "2",
      telegramChatId: "",
      telegramBotToken: "",
      discordGuildId: "",
      discordBotToken: "",
      fetchImpl,
    });
    assert.equal(called, 0);
    assert.equal(result.telegram, false);
    assert.equal(result.discord, false);
    assert.equal(result.verified, false);
  });
});
