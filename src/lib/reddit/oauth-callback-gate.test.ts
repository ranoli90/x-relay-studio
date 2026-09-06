import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callbackOriginAllowed,
  decideOauthCallback,
  popupMessageAccepted,
  revocationMaterialAad,
  type OauthTicketSnapshot,
} from "./oauth-callback-gate.ts";

function ticket(over: Partial<OauthTicketSnapshot> = {}): OauthTicketSnapshot {
  return {
    user_id: "user-a",
    redirect_uri: "http://127.0.0.1:8080/api/reddit/oauth/callback",
    expires_at: new Date(Date.now() + 60_000),
    processing_state: "open",
    processed_result_json: null,
    job_id: "job-1",
    correlation_id: "corr-123456",
    allowed_origin: "http://127.0.0.1:8080",
    purpose: "connect_account",
    attempt_generation: 1,
    cancelled_at: null,
    ...over,
  };
}

describe("oauth callback gate RC-010/015/017", () => {
  it("rejects a mismatched allowed origin even if the redirect origin matches a different host", () => {
    const row = ticket({
      allowed_origin: "https://studio.example",
      redirect_uri: "http://127.0.0.1:8080/api/reddit/oauth/callback",
    });
    assert.equal(callbackOriginAllowed(row, "http://127.0.0.1:8080"), false);
    assert.equal(decideOauthCallback({ ticket: row, requestOrigin: "http://127.0.0.1:8080" }).action, "reject");
  });

  it("rejects missing correlation, wrong purpose, stale generation, and cancelled tickets", () => {
    assert.equal(
      decideOauthCallback({ ticket: ticket({ correlation_id: null }), requestOrigin: "http://127.0.0.1:8080" }).action,
      "reject",
    );
    assert.equal(
      decideOauthCallback({ ticket: ticket({ purpose: "remote_takeover" }), requestOrigin: "http://127.0.0.1:8080" }).action,
      "reject",
    );
    assert.equal(
      decideOauthCallback({ ticket: ticket({ attempt_generation: 2 }), requestOrigin: "http://127.0.0.1:8080" }).action,
      "reject",
    );
    assert.equal(
      decideOauthCallback({
        ticket: ticket({ cancelled_at: new Date().toISOString() }),
        requestOrigin: "http://127.0.0.1:8080",
      }).action,
      "reject",
    );
  });

  it("replays a stored result and does not re-exchange a processing ticket", () => {
    const replay = decideOauthCallback({
      ticket: ticket({ processed_result_json: JSON.stringify({ ok: true, name: "alice" }) }),
      requestOrigin: "http://127.0.0.1:8080",
    });
    assert.equal(replay.action, "replay");
    const busy = decideOauthCallback({
      ticket: ticket({ processing_state: "processing", exchange_started_at: new Date().toISOString() }),
      requestOrigin: "http://127.0.0.1:8080",
    });
    assert.equal(busy.action, "busy");
  });

  it("recovers a crash after exchange when the account already exists, else marks uncertain when stale", () => {
    const recover = decideOauthCallback({
      ticket: ticket({ processing_state: "processing", exchange_started_at: new Date().toISOString() }),
      requestOrigin: "http://127.0.0.1:8080",
      linkedAccount: { id: "acct-1", name: "alice" },
    });
    assert.deepEqual(recover, { action: "recover", accountId: "acct-1", name: "alice" });
    const uncertain = decideOauthCallback({
      ticket: ticket({
        processing_state: "processing",
        exchange_started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      }),
      requestOrigin: "http://127.0.0.1:8080",
    });
    assert.equal(uncertain.action, "uncertain");
  });

  it("does not treat a missing popup correlation as a wildcard success", () => {
    assert.equal(
      popupMessageAccepted({
        expectedCorrelationId: "corr-123456",
        messageCorrelationId: null,
        origin: "http://127.0.0.1:8080",
        pageOrigin: "http://127.0.0.1:8080",
      }),
      false,
    );
    assert.equal(
      popupMessageAccepted({
        expectedCorrelationId: "corr-123456",
        messageCorrelationId: "corr-123456",
        origin: "http://127.0.0.1:8080",
        pageOrigin: "http://127.0.0.1:8080",
      }),
      true,
    );
  });

  it("pins revocation material to the owner, not the job id", () => {
    assert.deepEqual(revocationMaterialAad({ userId: "user-a", jobId: "job-1" }), {
      userId: "user-a",
      recordId: "user-a",
      purpose: "oauth_revocation_material",
    });
    assert.deepEqual(revocationMaterialAad({ userId: "user-a", accountId: "acct-1", jobId: "job-1" }), {
      userId: "user-a",
      recordId: "acct-1",
      purpose: "oauth_revocation_material",
    });
  });
});
