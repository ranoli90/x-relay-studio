import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { BrowserProviderError, DEFAULT_SESSION_POLICY } from "../provider.ts";
import { LocalBrowserProvider, resetLocalProvider } from "./local.ts";

afterEach(() => {
  resetLocalProvider();
  delete process.env.VERCEL;
});

function stubLauncher() {
  let closed = false;
  let clicks: Array<[number, number]> = [];
  return {
    closed: () => closed,
    clicks: () => clicks,
    launch: async () => ({
      page: {
        screenshot: async () => Buffer.from("jpeg"),
        click: async (x: number, y: number) => {
          clicks.push([x, y]);
        },
        type: async () => undefined,
        press: async () => undefined,
        url: () => "http://127.0.0.1:8080/__reddit-onboarding-fixture/index.html",
      },
      close: async () => {
        closed = true;
      },
    }),
  };
}

describe("local chromium provider", () => {
  it("reuses a session for the same allocation intent", async () => {
    const stub = stubLauncher();
    const provider = new LocalBrowserProvider(stub.launch);
    const first = await provider.createSession({
      jobId: "job-1",
      allocationIntentId: "intent-1",
      generation: 1,
      policy: DEFAULT_SESSION_POLICY,
    });
    const second = await provider.createSession({
      jobId: "job-1",
      allocationIntentId: "intent-1",
      generation: 1,
      policy: DEFAULT_SESSION_POLICY,
    });
    assert.equal(first.sessionId, second.sessionId);
    assert.equal(first.region, "self-hosted");
    assert.equal(first.status, "running");
  });

  it("refuses to launch on Vercel", async () => {
    process.env.VERCEL = "1";
    const stub = stubLauncher();
    const provider = new LocalBrowserProvider(stub.launch);
    await assert.rejects(
      () =>
        provider.createSession({
          jobId: "job-1",
          allocationIntentId: "intent-v",
          generation: 1,
          policy: DEFAULT_SESSION_POLICY,
        }),
      (err: unknown) => err instanceof BrowserProviderError && err.code === "PROVIDER_NOT_CONFIGURED",
    );
  });

  it("releases the browser and rejects input after revoke", async () => {
    const stub = stubLauncher();
    const provider = new LocalBrowserProvider(stub.launch);
    const session = await provider.createSession({
      jobId: "job-1",
      allocationIntentId: "intent-2",
      generation: 1,
      policy: DEFAULT_SESSION_POLICY,
    });
    const view = await provider.issueControlView(session.sessionId, 4);
    assert.equal(view.url, `local://view/${session.sessionId}`);
    await provider.input(session.sessionId, { action: "click", x: 10, y: 20 });
    assert.deepEqual(stub.clicks(), [[10, 20]]);
    const revoked = await provider.revokeControlView(session.sessionId, 4);
    assert.equal(revoked.verified, true);
    await assert.rejects(
      () => provider.input(session.sessionId, { action: "click", x: 1, y: 1 }),
      (err: unknown) => err instanceof BrowserProviderError && err.code === "CONTROL_NOT_READY",
    );
    const released = await provider.requestRelease(session.sessionId);
    assert.equal(released.ended, true);
    assert.equal(stub.closed(), true);
  });
});
