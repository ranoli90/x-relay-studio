import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  floodWaitSeconds,
  isAccountFrozen,
  isAuthKeyDuplicated,
  isDcConnectFailure,
  isPeerFlood,
  mtprotoClientOpts,
} from "./mtproto-policy.server.ts";

describe("mtproto policy", () => {
  it("parses FLOOD_WAIT and SLOWMODE_WAIT seconds", () => {
    assert.equal(floodWaitSeconds("A wait of FLOOD_WAIT_17 is required"), 17);
    assert.equal(floodWaitSeconds("SLOWMODE_WAIT_8"), 8);
    assert.equal(floodWaitSeconds("nope"), null);
  });

  it("detects Failed to connect to DC 2", () => {
    assert.equal(isDcConnectFailure("Failed to connect to DC 2"), true);
    assert.equal(isDcConnectFailure("failed to connect to dc2"), true);
    assert.equal(isDcConnectFailure("PHONE_NUMBER_INVALID"), false);
  });

  it("detects session-killing errors", () => {
    assert.equal(isAuthKeyDuplicated("AUTH_KEY_DUPLICATED"), true);
    assert.equal(isAuthKeyDuplicated("AUTH_KEY_UNREGISTERED"), true);
    assert.equal(isAuthKeyDuplicated("AUTH_KEY_INVALID"), true);
    assert.equal(isPeerFlood("PEER_FLOOD"), true);
    assert.equal(isAccountFrozen("USER_DEACTIVATED_BAN"), true);
  });

  it("pins a stable unofficial fingerprint and does not embed Node", () => {
    const opts = mtprotoClientOpts("tcp");
    assert.equal(opts.useWSS, false);
    assert.equal(opts.useIPV6, false);
    assert.equal(opts.requestRetries, 1);
    assert.ok(opts.connectionRetries <= 2);
    assert.equal(opts.autoReconnect, false);
    assert.match(String(opts.deviceModel), /X Relay Studio|Studio/);
    assert.equal(opts.systemVersion, "X Relay Studio");
    assert.doesNotMatch(String(opts.systemVersion), /Node/i);
  });

  it("can flip to WSS for the fallback pass", () => {
    assert.equal(mtprotoClientOpts("wss").useWSS, true);
  });
});
