/** Parent should add this file to package.json `test`. Gate-only — no @/lib/db or mtproto import. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideAgentSendPath } from "./agent-send.server.ts";

const liveSession = { session_enc: "enc", auth_dead: false };
const liveAccount = { preview: false };

describe("decideAgentSendPath", () => {
  it("is live only with a real account, live session, and private hash", () => {
    assert.equal(
      decideAgentSendPath({
        account: liveAccount,
        session: liveSession,
        peerId: "42",
        peerKind: "user",
        accessHash: "99",
        chatKind: "user",
      }),
      "live",
    );
  });

  it("stays not_live for preview, unlinked, dead session, service peer, missing hash", () => {
    assert.equal(
      decideAgentSendPath({
        account: { preview: true },
        session: liveSession,
        peerId: "42",
        peerKind: "user",
        accessHash: "99",
        chatKind: "user",
      }),
      "not_live",
    );
    assert.equal(
      decideAgentSendPath({
        account: null,
        session: liveSession,
        peerId: "42",
        peerKind: "user",
        accessHash: "99",
        chatKind: "user",
      }),
      "not_live",
    );
    assert.equal(
      decideAgentSendPath({
        account: liveAccount,
        session: { session_enc: null, auth_dead: false },
        peerId: "42",
        peerKind: "user",
        accessHash: "99",
        chatKind: "user",
      }),
      "not_live",
    );
    assert.equal(
      decideAgentSendPath({
        account: liveAccount,
        session: { session_enc: "enc", auth_dead: true },
        peerId: "42",
        peerKind: "user",
        accessHash: "99",
        chatKind: "user",
      }),
      "not_live",
    );
    assert.equal(
      decideAgentSendPath({
        account: liveAccount,
        session: liveSession,
        peerId: "777000",
        peerKind: "user",
        accessHash: "99",
        chatKind: "user",
      }),
      "not_live",
    );
    assert.equal(
      decideAgentSendPath({
        account: liveAccount,
        session: liveSession,
        peerId: "42",
        peerKind: "user",
        accessHash: null,
        chatKind: "user",
      }),
      "not_live",
    );
    assert.equal(
      decideAgentSendPath({
        account: liveAccount,
        session: liveSession,
        peerId: "42",
        peerKind: "user",
        accessHash: "99",
        chatKind: "notes",
      }),
      "not_live",
    );
    assert.equal(
      decideAgentSendPath({
        account: liveAccount,
        session: liveSession,
        peerId: null,
        peerKind: "user",
        accessHash: "99",
        chatKind: "user",
      }),
      "not_live",
    );
  });

  it("does not require an access hash for basic group chats", () => {
    assert.equal(
      decideAgentSendPath({
        account: liveAccount,
        session: liveSession,
        peerId: "-42",
        peerKind: "chat",
        accessHash: null,
        chatKind: "user",
      }),
      "live",
    );
  });
});
