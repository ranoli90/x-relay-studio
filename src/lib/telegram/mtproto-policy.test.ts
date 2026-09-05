import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  floodWaitSeconds,
  isDcConnectFailure,
  mtprotoClientOpts,
} from "./mtproto-policy.server.ts";

describe("mtproto policy", () => {
  it("parses FLOOD_WAIT seconds", () => {
    assert.equal(floodWaitSeconds("A wait of FLOOD_WAIT_17 is required"), 17);
    assert.equal(floodWaitSeconds("nope"), null);
  });

  it("detects Failed to connect to DC 2", () => {
    assert.equal(isDcConnectFailure("Failed to connect to DC 2"), true);
    assert.equal(isDcConnectFailure("failed to connect to dc2"), true);
    assert.equal(isDcConnectFailure("PHONE_NUMBER_INVALID"), false);
  });

  it("defaults to IPv4 TCP with retries", () => {
    const opts = mtprotoClientOpts("tcp");
    assert.equal(opts.useWSS, false);
    assert.equal(opts.useIPV6, false);
    assert.ok(opts.connectionRetries >= 3);
  });

  it("can flip to WSS for the fallback pass", () => {
    assert.equal(mtprotoClientOpts("wss").useWSS, true);
  });
});
