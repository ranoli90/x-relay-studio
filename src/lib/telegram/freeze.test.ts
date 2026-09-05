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
});

describe("mtproto device pin", () => {
  it("does not default systemVersion to the Node runtime", () => {
    const opts = mtprotoClientOpts("tcp");
    assert.equal(opts.systemVersion.includes("Node"), false);
    assert.equal(opts.deviceModel.includes("Node"), false);
    assert.equal(opts.requestRetries, 1);
  });
});
