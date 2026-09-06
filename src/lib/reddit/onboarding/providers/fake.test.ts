import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DEFAULT_SESSION_POLICY } from "../provider.ts";
import { FakeBrowserProvider, resetFakeProvider } from "./fake.ts";

afterEach(() => {
  resetFakeProvider();
});

function sessionInput(allocationIntentId: string, jobId = "job") {
  return {
    jobId,
    allocationIntentId,
    generation: 1,
    policy: DEFAULT_SESSION_POLICY,
  };
}

describe("fake provider identifiers", () => {
  it("uses the full jobId and allocationIntentId rather than truncated prefixes", async () => {
    const provider = new FakeBrowserProvider();
    const a = await provider.createContext({
      jobId: "aaaaaaaa-1111-xxxx",
      userId: "u",
      environmentId: "preview",
    });
    const b = await provider.createContext({
      jobId: "aaaaaaaa-2222-xxxx",
      userId: "u",
      environmentId: "preview",
    });
    assert.equal(a.contextId, "fake-ctx-aaaaaaaa-1111-xxxx");
    assert.equal(b.contextId, "fake-ctx-aaaaaaaa-2222-xxxx");
    assert.notEqual(a.contextId, b.contextId);

    const s1 = await provider.createSession(sessionInput("bbbbbbbbbbbb-1"));
    const s2 = await provider.createSession(sessionInput("bbbbbbbbbbbb-2"));
    assert.equal(s1.sessionId, "fake-ses-bbbbbbbbbbbb-1");
    assert.equal(s2.sessionId, "fake-ses-bbbbbbbbbbbb-2");
    assert.notEqual(s1.sessionId, s2.sessionId);
  });

  it("reuses a session for the same allocation intent", async () => {
    const provider = new FakeBrowserProvider();
    const first = await provider.createSession(sessionInput("intent-same"));
    const second = await provider.createSession(sessionInput("intent-same"));
    assert.equal(first.sessionId, second.sessionId);
  });

  it("keeps failPrivacy, delay, lost create, and release-does-not-end knobs", async () => {
    const privacy = new FakeBrowserProvider();
    privacy.failPrivacy = true;
    await assert.rejects(() => privacy.createSession(sessionInput("p")), /privacy/i);

    const delayed = new FakeBrowserProvider();
    delayed.delayCreateMs = 20;
    const started = Date.now();
    await delayed.createSession(sessionInput("delay"));
    assert.ok(Date.now() - started >= 15);

    const lost = new FakeBrowserProvider();
    lost.loseCreateResponse = true;
    await assert.rejects(() => lost.createSession(sessionInput("lost")), /lost/i);
    const recovered = await lost.getSession("fake-ses-lost");
    assert.ok(recovered);

    const sticky = new FakeBrowserProvider();
    sticky.releaseDoesNotEnd = true;
    const session = await sticky.createSession(sessionInput("sticky"));
    const release = await sticky.requestRelease(session.sessionId);
    assert.equal(release.accepted, true);
    assert.equal(release.ended, false);
    const current = await sticky.getSession(session.sessionId);
    assert.equal(current?.status, "releasing");
  });
});
