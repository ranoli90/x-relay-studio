import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TelegramError, isTerminalSessionError } from "./errors.ts";
import { mapRpc } from "./map-rpc.ts";
import {
  floodWaitSeconds,
  isAccountFrozen,
  isAuthKeyDuplicated,
  isPeerFlood,
  mtprotoClientOpts,
} from "./mtproto-policy.server.ts";
import { historyFailureKind, isCollapsedHistoryMiss, peerKindFromId, peerNeedsAccessHash, assertPrivatePeerHash, parseAccessHash } from "./peer.ts";
import { sendOutcomeFromError } from "./send-intent.server.ts";

describe("freeze error mapping helpers", () => {
  it("parses FLOOD_WAIT seconds", () => {
    assert.equal(floodWaitSeconds("FLOOD_WAIT_32"), 32);
    assert.equal(floodWaitSeconds("SLOWMODE_WAIT_8"), 8);
    assert.equal(floodWaitSeconds("ok"), null);
  });

  it("detects dead auth keys", () => {
    assert.equal(isAuthKeyDuplicated("AUTH_KEY_DUPLICATED"), true);
    assert.equal(isAuthKeyDuplicated("AUTH_KEY_UNREGISTERED"), true);
    assert.equal(isAuthKeyDuplicated("SESSION_REVOKED"), true);
    assert.equal(isAuthKeyDuplicated("FLOOD_WAIT_5"), false);
  });

  it("detects peer flood and frozen accounts", () => {
    assert.equal(isPeerFlood("PEER_FLOOD"), true);
    assert.equal(isAccountFrozen("USER_DEACTIVATED_BAN"), true);
    assert.equal(isPeerFlood("FLOOD_WAIT_5"), false);
  });

  it("marks auth_dead and peer_flood as terminal", () => {
    assert.equal(isTerminalSessionError("auth_dead"), true);
    assert.equal(isTerminalSessionError("peer_flood"), true);
    assert.equal(isTerminalSessionError("unlinked"), true);
    assert.equal(isTerminalSessionError("flood"), false);
  });
});

describe("mapRpc freeze codes", () => {
  it("maps AUTH_KEY_DUPLICATED to auth_dead", () => {
    const err = mapRpc(new Error("AUTH_KEY_DUPLICATED"));
    assert.equal(err.code, "auth_dead");
    assert.equal(err.status, 401);
  });

  it("maps SESSION_REVOKED to a revoked terminal, not a generic miss", () => {
    const err = mapRpc(new Error("SESSION_REVOKED"));
    assert.equal(err.code, "auth_dead");
    assert.match(err.message, /revoked/i);
  });

  it("maps PEER_FLOOD to peer_flood", () => {
    const err = mapRpc(new Error("PEER_FLOOD"));
    assert.equal(err.code, "peer_flood");
    assert.equal(err.floodSeconds, 3600);
  });

  it("keeps FLOOD_WAIT seconds", () => {
    const err = mapRpc(new Error("FLOOD_WAIT_17"));
    assert.equal(err.code, "flood");
    assert.equal(err.floodSeconds, 17);
  });

  it("does not collapse CHANNEL_PRIVATE into a generic miss", () => {
    const err = mapRpc(new Error("CHANNEL_PRIVATE"));
    assert.equal(err.code, "invalid");
    assert.match(err.message, /refresh/i);
  });
});

describe("F18 private peer access hashes", () => {
  it("requires an access hash for users and channels, not basic chats", () => {
    assert.equal(peerKindFromId("12345"), "user");
    assert.equal(peerKindFromId("-100123456"), "channel");
    assert.equal(peerKindFromId("-123456"), "chat");
    assert.equal(peerNeedsAccessHash("user"), true);
    assert.equal(peerNeedsAccessHash("channel"), true);
    assert.equal(peerNeedsAccessHash("chat"), false);
    assert.equal(parseAccessHash("0"), null);
    assert.equal(parseAccessHash("987654321"), "987654321");
    assert.throws(() => assertPrivatePeerHash("user", null));
    assert.throws(() => assertPrivatePeerHash("channel", "0"));
    assert.doesNotThrow(() => assertPrivatePeerHash("chat", null));
    assert.doesNotThrow(() => assertPrivatePeerHash("user", "12345"));
  });

  it("classifies history failures without collapsing flood or revoked", () => {
    assert.equal(historyFailureKind(new Error("FLOOD_WAIT_32")), "flood");
    assert.equal(historyFailureKind(new Error("SESSION_REVOKED")), "revoked");
    assert.equal(historyFailureKind(new Error("AUTH_KEY_UNREGISTERED")), "dead");
    assert.equal(historyFailureKind(new Error("CHANNEL_PRIVATE")), "need_hash");
    assert.equal(historyFailureKind(new Error("random miss")), "miss");
    assert.equal(
      historyFailureKind(new TelegramError("auth_dead", "Telegram revoked this session.", 401)),
      "revoked",
    );
    assert.equal(
      historyFailureKind(new TelegramError("flood", "Couldn't reach Telegram just now. Try again.", 503, 8)),
      "flood",
    );
    assert.equal(isCollapsedHistoryMiss("miss"), true);
    assert.equal(isCollapsedHistoryMiss("need_hash"), true);
    assert.equal(isCollapsedHistoryMiss("flood"), false);
    assert.equal(isCollapsedHistoryMiss("revoked"), false);
    assert.equal(isCollapsedHistoryMiss("dead"), false);
  });

  it("keeps user/group/channel access-hash material across a null upsert", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
      create table telegram_chats (
        id text primary key,
        user_id text not null,
        kind text not null,
        title text not null,
        peer_id text,
        access_hash text,
        peer_kind text
      );
    `);
    await pg.query(
      `insert into telegram_chats (id, user_id, kind, title, peer_id, access_hash, peer_kind)
       values ($1,$2,'user',$3,$4,$5,$6)
       on conflict (id) do update set
         access_hash = coalesce(excluded.access_hash, telegram_chats.access_hash),
         peer_kind = coalesce(excluded.peer_kind, telegram_chats.peer_kind)`,
      ["c_user", "u1", "Ada", "42", "111", "user"],
    );
    await pg.query(
      `insert into telegram_chats (id, user_id, kind, title, peer_id, access_hash, peer_kind)
       values ($1,$2,'user',$3,$4,$5,$6)
       on conflict (id) do update set
         access_hash = coalesce(excluded.access_hash, telegram_chats.access_hash),
         peer_kind = coalesce(excluded.peer_kind, telegram_chats.peer_kind)`,
      ["c_user", "u1", "Ada", "42", null, "user"],
    );
    await pg.query(
      `insert into telegram_chats (id, user_id, kind, title, peer_id, access_hash, peer_kind)
       values ($1,$2,'user',$3,$4,$5,$6)`,
      ["c_chat", "u1", "Group", "-99", null, "chat"],
    );
    await pg.query(
      `insert into telegram_chats (id, user_id, kind, title, peer_id, access_hash, peer_kind)
       values ($1,$2,'user',$3,$4,$5,$6)`,
      ["c_chan", "u1", "Channel", "-1001", "222", "channel"],
    );
    const rows = (
      await pg.query<{ id: string; access_hash: string | null; peer_kind: string }>(
        `select id, access_hash, peer_kind from telegram_chats order by id`,
      )
    ).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId.c_user.access_hash, "111");
    assert.equal(byId.c_user.peer_kind, "user");
    assert.equal(byId.c_chat.access_hash, null);
    assert.equal(byId.c_chat.peer_kind, "chat");
    assert.equal(byId.c_chan.access_hash, "222");
    assert.equal(byId.c_chan.peer_kind, "channel");
    await pg.close();
  });
});

describe("human send outcomes", () => {
  it("marks network/unknown as uncertain, not sent", () => {
    assert.equal(sendOutcomeFromError(new Error("fetch failed")), "uncertain");
    assert.equal(sendOutcomeFromError(new TelegramError("invalid", "bad peer", 400)), "failed");
  });
});

describe("mtproto device pin", () => {
  it("does not default systemVersion to the Node runtime", () => {
    const opts = mtprotoClientOpts("tcp");
    assert.equal(opts.systemVersion.includes("Node"), false);
    assert.equal(opts.deviceModel.includes("Node"), false);
    assert.equal(opts.requestRetries, 1);
  });
});
