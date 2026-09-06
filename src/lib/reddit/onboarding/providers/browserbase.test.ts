import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { BrowserProviderError, DEFAULT_SESSION_POLICY } from "../provider.ts";
import { BrowserbaseProvider, mapBrowserbaseStatus } from "./browserbase.ts";

const ENV_KEYS = ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "BROWSERBASE_REGION"] as const;
const snapshot: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) snapshot[key] = process.env[key];

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  signal?: AbortSignal;
};

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];
let handler: ((call: FetchCall) => Promise<Response> | Response) | null = null;

function headerMap(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = String(value);
    return out;
  }
  for (const [key, value] of Object.entries(headers)) out[key] = String(value);
  return out;
}

function stubFetch(next: (call: FetchCall) => Promise<Response> | Response) {
  handler = next;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: FetchCall = {
      url,
      method: (init?.method || "GET").toUpperCase(),
      headers: headerMap(init?.headers),
      body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null,
      signal: init?.signal && init.signal instanceof AbortSignal ? init.signal : undefined,
    };
    calls.push(call);
    return await next(call);
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(status: number, body: string, headers?: Record<string, string>) {
  return new Response(body, { status, headers });
}

function sessionInput(over: { persist?: boolean; contextId?: string } = {}) {
  return {
    jobId: "job-1",
    allocationIntentId: "intent-1",
    generation: 1,
    policy: DEFAULT_SESSION_POLICY,
    contextId: over.contextId,
    persist: over.persist,
  };
}

function codeOf(err: unknown): string {
  assert.ok(err instanceof BrowserProviderError);
  return err.code;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  handler = null;
  calls = [];
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("browserbase adapter", () => {
  it("uses the official api.browserbase.com endpoint and X-BB-API-Key", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    stubFetch(() =>
      jsonResponse(200, { id: "ses-1", status: "RUNNING", connectUrl: "wss://example.test" }),
    );
    const provider = new BrowserbaseProvider();
    await provider.getSession("ses-1");
    assert.equal(calls[0]?.url, "https://api.browserbase.com/v1/sessions/ses-1");
    assert.equal(calls[0]?.headers["X-BB-API-Key"], "test-bb-key");
    assert.ok(calls[0]?.signal instanceof AbortSignal);
    assert.equal(handler !== null, true);
  });

  it("maps documented statuses and rejects unknown as not running", () => {
    assert.equal(mapBrowserbaseStatus("PENDING"), "pending");
    assert.equal(mapBrowserbaseStatus("RUNNING"), "running");
    assert.equal(mapBrowserbaseStatus("ERROR"), "ended");
    assert.equal(mapBrowserbaseStatus("TIMED_OUT"), "ended");
    assert.equal(mapBrowserbaseStatus("COMPLETED"), "ended");
    assert.throws(() => mapBrowserbaseStatus("WHATEVER"), (err: unknown) => codeOf(err) === "PROVIDER_UNKNOWN_STATUS");
    assert.throws(() => mapBrowserbaseStatus(undefined), (err: unknown) => codeOf(err) === "PROVIDER_UNKNOWN_STATUS");
  });

  it("returns pending rather than running for PENDING sessions", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    stubFetch(() => jsonResponse(200, { id: "ses-p", status: "PENDING", connectUrl: "wss://example.test" }));
    const session = await new BrowserbaseProvider().getSession("ses-p");
    assert.equal(session?.status, "pending");
    assert.notEqual(session?.status, "running");
  });

  it("maps TIMED_OUT and ERROR to ended, not running", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    const provider = new BrowserbaseProvider();
    stubFetch(() => jsonResponse(200, { id: "ses-t", status: "TIMED_OUT" }));
    assert.equal((await provider.getSession("ses-t"))?.status, "ended");
    stubFetch(() => jsonResponse(200, { id: "ses-e", status: "ERROR" }));
    assert.equal((await provider.getSession("ses-e"))?.status, "ended");
    stubFetch(() => jsonResponse(200, { id: "ses-c", status: "COMPLETED" }));
    assert.equal((await provider.getSession("ses-c"))?.status, "ended");
  });

  it("throws on unknown status from getSession", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    stubFetch(() => jsonResponse(200, { id: "ses-u", status: "MYSTERY" }));
    await assert.rejects(
      () => new BrowserbaseProvider().getSession("ses-u"),
      (err: unknown) => codeOf(err) === "PROVIDER_UNKNOWN_STATUS",
    );
  });

  it("treats invalid JSON as failure, not success", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    stubFetch(() => textResponse(200, "not-json", { "content-type": "application/json" }));
    await assert.rejects(
      () => new BrowserbaseProvider().getSession("ses-1"),
      (err: unknown) => codeOf(err) === "PROVIDER_UNAVAILABLE",
    );
    stubFetch(() => textResponse(201, "{bad", { "content-type": "application/json" }));
    await assert.rejects(
      () => new BrowserbaseProvider().createSession(sessionInput()),
      (err: unknown) => codeOf(err) === "SESSION_AMBIGUOUS",
    );
  });

  it("maps 429 to PROVIDER_RATE_LIMITED", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    stubFetch(() => jsonResponse(429, { error: "slow down" }, { "retry-after": "12" }));
    await assert.rejects(
      () => new BrowserbaseProvider().getSession("ses-1"),
      (err: unknown) => {
        assert.equal(codeOf(err), "PROVIDER_RATE_LIMITED");
        assert.ok(err instanceof BrowserProviderError);
        assert.equal(err.retryAfterSeconds, 12);
        return true;
      },
    );
  });

  it("maps 5xx on create to SESSION_AMBIGUOUS and 5xx on get to PROVIDER_UNAVAILABLE", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    stubFetch(() => jsonResponse(503, { error: "down" }));
    await assert.rejects(
      () => new BrowserbaseProvider().createSession(sessionInput()),
      (err: unknown) => codeOf(err) === "SESSION_AMBIGUOUS",
    );
    stubFetch(() => jsonResponse(500, { error: "down" }));
    await assert.rejects(
      () => new BrowserbaseProvider().getSession("ses-1"),
      (err: unknown) => codeOf(err) === "PROVIDER_UNAVAILABLE",
    );
  });

  it("normalizes AbortError and TypeError on create and get", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    stubFetch(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    await assert.rejects(
      () => new BrowserbaseProvider().createSession(sessionInput()),
      (err: unknown) => codeOf(err) === "SESSION_AMBIGUOUS",
    );
    stubFetch(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    await assert.rejects(
      () => new BrowserbaseProvider().getSession("ses-1"),
      (err: unknown) => codeOf(err) === "PROVIDER_TIMEOUT",
    );
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      () => new BrowserbaseProvider().createSession(sessionInput()),
      (err: unknown) => codeOf(err) === "SESSION_AMBIGUOUS",
    );
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      () => new BrowserbaseProvider().getSession("ses-1"),
      (err: unknown) => codeOf(err) === "PROVIDER_TIMEOUT",
    );
  });

  it("treats 404 get as absence and 404 delete as already deleted", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    const provider = new BrowserbaseProvider();
    stubFetch(() => textResponse(404, ""));
    assert.equal(await provider.getSession("missing"), null);
    stubFetch(() => textResponse(404, ""));
    assert.deepEqual(await provider.deleteContext("missing-ctx"), { deleted: true });
  });

  it("sends persist true only when the caller asks", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    const provider = new BrowserbaseProvider();
    stubFetch(() => jsonResponse(201, { id: "ses-1", status: "RUNNING", connectUrl: "wss://example.test" }));
    await provider.createSession(sessionInput({ contextId: "ctx-1" }));
    const defaultBody = JSON.parse(calls[0]?.body || "{}") as { browserSettings: { context: { persist: boolean } } };
    assert.equal(defaultBody.browserSettings.context.persist, false);

    calls = [];
    stubFetch(() => jsonResponse(201, { id: "ses-2", status: "RUNNING", connectUrl: "wss://example.test" }));
    await provider.createSession(sessionInput({ contextId: "ctx-1", persist: true }));
    const persistBody = JSON.parse(calls[0]?.body || "{}") as { browserSettings: { context: { persist: boolean } } };
    assert.equal(persistBody.browserSettings.context.persist, true);
    assert.equal(JSON.parse(calls[0]?.body || "{}").browserSettings.recordSession, false);
    assert.equal(JSON.parse(calls[0]?.body || "{}").browserSettings.logSession, false);
    assert.equal(JSON.parse(calls[0]?.body || "{}").browserSettings.solveCaptchas, false);
    assert.equal(JSON.parse(calls[0]?.body || "{}").browserSettings.advancedStealth, false);
  });

  it("does not invent usage seconds or claim control revocation", async () => {
    process.env.BROWSERBASE_API_KEY = "test-bb-key";
    process.env.BROWSERBASE_PROJECT_ID = "proj-1";
    const provider = new BrowserbaseProvider();
    stubFetch(() => jsonResponse(200, { id: "ses-1", status: "RUNNING" }));
    assert.deepEqual(await provider.usage("ses-1"), { seconds: null, unknown: true });
    stubFetch(() => jsonResponse(200, { id: "ses-2", status: "COMPLETED", durationSeconds: 42 }));
    assert.deepEqual(await provider.usage("ses-2"), { seconds: 42, unknown: false });
    assert.deepEqual(await provider.revokeControlView("ses-1", 1), { revoked: false, verified: false });
  });
});
