import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTH_REQUEST_RETRIES,
  WRITE_REQUEST_RETRIES,
  floodWaitSeconds,
  isAccountFrozen,
  isAuthKeyDuplicated,
  isDcConnectFailure,
  isDcMigrate,
  isPeerFlood,
  isRequestBudgetFailure,
  mtprotoClientOpts,
} from "./mtproto-policy.server.ts";
import { mapRpc } from "./map-rpc.ts";
import { normalizePhone } from "./phone.ts";

/**
 * Mirrors teleproto/gramjs invoke: `for (attempt = 0; attempt < requestRetries; attempt++)`.
 * DC migrate and CONNECTION_NOT_INITED consume an attempt then continue.
 * Genuine RPC errors abort immediately.
 */
type InvokeEvent = "ok" | "rpc" | "migrate_dc" | "connection_not_inited";

function simulateInvoke(requestRetries: number, events: InvokeEvent[]): {
  outcome: "ok" | "rpc" | "budget";
  attempts: number;
  last?: InvokeEvent;
} {
  let attempt = 0;
  let i = 0;
  for (attempt = 0; attempt < requestRetries; attempt++) {
    const ev = events[i++] ?? "ok";
    if (ev === "ok") return { outcome: "ok", attempts: attempt + 1, last: ev };
    if (ev === "rpc") return { outcome: "rpc", attempts: attempt + 1, last: ev };
  }
  return { outcome: "budget", attempts: attempt, last: events[i - 1] };
}

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

  it("detects request-budget exhaustion and DC migrate", () => {
    assert.equal(isRequestBudgetFailure("Request was unsuccessful 1 time(s)"), true);
    assert.equal(isRequestBudgetFailure("Request was unsuccessful 5 time(s)"), true);
    assert.equal(isRequestBudgetFailure("PHONE_NUMBER_INVALID"), false);
    assert.equal(isDcMigrate("PHONE_MIGRATE_2"), true);
    assert.equal(isDcMigrate("NETWORK_MIGRATE_4"), true);
    assert.equal(isDcMigrate("CONNECTION_NOT_INITED"), true);
    assert.equal(isDcMigrate("PHONE_NUMBER_INVALID"), false);
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
    assert.equal(opts.requestRetries, WRITE_REQUEST_RETRIES);
    assert.equal(opts.requestRetries, 1);
    assert.ok(opts.connectionRetries <= 2);
    assert.equal(opts.autoReconnect, false);
    assert.match(String(opts.deviceModel), /X Relay Studio|Studio/);
    assert.equal(opts.systemVersion, "X Relay Studio");
    assert.doesNotMatch(String(opts.systemVersion), /Node/i);
  });

  it("gives login a larger request budget than ordinary writes", () => {
    const auth = mtprotoClientOpts("tcp", "auth");
    const write = mtprotoClientOpts("tcp", "write");
    assert.equal(auth.requestRetries, AUTH_REQUEST_RETRIES);
    assert.equal(auth.requestRetries, 5);
    assert.equal(write.requestRetries, WRITE_REQUEST_RETRIES);
    assert.equal(write.requestRetries, 1);
  });

  it("can flip to WSS for the fallback pass", () => {
    assert.equal(mtprotoClientOpts("wss").useWSS, true);
  });
});

describe("auth invoke retry budget", () => {
  it("fails a DC redirect when requestRetries is 1", () => {
    const result = simulateInvoke(WRITE_REQUEST_RETRIES, ["migrate_dc", "ok"]);
    assert.equal(result.outcome, "budget");
    assert.equal(result.attempts, 1);
  });

  it("finishes sendCode after a DC redirect when login has five attempts", () => {
    const result = simulateInvoke(AUTH_REQUEST_RETRIES, ["migrate_dc", "ok"]);
    assert.equal(result.outcome, "ok");
    assert.equal(result.attempts, 2);
  });

  it("recovers from DC redirect plus CONNECTION_NOT_INITED", () => {
    const result = simulateInvoke(AUTH_REQUEST_RETRIES, [
      "migrate_dc",
      "connection_not_inited",
      "ok",
    ]);
    assert.equal(result.outcome, "ok");
    assert.equal(result.attempts, 3);
  });

  it("does not retry a genuine invalid-number error", () => {
    const result = simulateInvoke(AUTH_REQUEST_RETRIES, ["rpc", "ok"]);
    assert.equal(result.outcome, "rpc");
    assert.equal(result.attempts, 1);
  });
});

describe("mapRpc login failures", () => {
  it("does not blame the phone for a one-attempt request budget miss", () => {
    const err = mapRpc(new Error("Request was unsuccessful 1 time(s)"));
    assert.equal(err.code, "flood");
    assert.equal(err.status, 503);
    assert.doesNotMatch(err.message, /didn.t accept that/i);
    assert.doesNotMatch(err.message, /phone number didn.t work/i);
  });

  it("maps PHONE_NUMBER_UNOCCUPIED as unregistered, not an app flood", () => {
    const err = mapRpc(new Error("PHONE_NUMBER_UNOCCUPIED (caused by SendCode)"));
    assert.equal(err.code, "invalid");
    assert.equal(err.status, 400);
    assert.match(err.message, /isn.t registered/i);
    assert.doesNotMatch(err.message, /api_id/i);
  });

  it("still maps a genuine invalid number distinctly", () => {
    const err = mapRpc(new Error("PHONE_NUMBER_INVALID"));
    assert.equal(err.code, "invalid");
    assert.match(err.message, /country code/i);
  });

  it("does not treat an unknown exception as an invalid phone", () => {
    const err = mapRpc(new Error("something exploded in the client"));
    assert.equal(err.code, "flood");
    assert.equal(err.status, 503);
    assert.doesNotMatch(err.message, /didn.t accept that/i);
  });
});

describe("phone E.164", () => {
  it("keeps international numbers and rejects national-only US digits", () => {
    assert.equal(normalizePhone("+1 (555) 123-4567"), "+15551234567");
    assert.equal(normalizePhone("15551234567"), "+15551234567");
    assert.equal(normalizePhone("+1 303 555 0100"), "+13035550100");
    assert.equal(normalizePhone("3035550100"), null);
  });
});
