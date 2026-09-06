import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { BrowserProviderError, DEFAULT_SESSION_POLICY } from "../provider.ts";
import { SteelProvider, mapSteelStatus } from "./steel.ts";

const ENV_KEYS = ["STEEL_API_URL", "STEEL_API_KEY"] as const;
const snapshot: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) snapshot[key] = process.env[key];

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

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

function stubFetch(next: (call: FetchCall) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: FetchCall = {
      url,
      method: (init?.method || "GET").toUpperCase(),
      headers: headerMap(init?.headers),
      body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null,
    };
    calls.push(call);
    return next(call);
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sessionInput() {
  return {
    jobId: "job-1",
    allocationIntentId: "intent-1",
    generation: 1,
    policy: DEFAULT_SESSION_POLICY,
  };
}

function codeOf(err: unknown): string {
  assert.ok(err instanceof BrowserProviderError);
  return err.code;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("steel adapter", () => {
  it("talks to a self-hosted base URL without requiring a cloud key", async () => {
    process.env.STEEL_API_URL = "http://127.0.0.1:3000";
    delete process.env.STEEL_API_KEY;
    stubFetch(() => jsonResponse(200, { id: "ses-1", status: "live", websocketUrl: "ws://127.0.0.1:3000/v1/sessions/ses-1/cdp" }));
    const session = await new SteelProvider().getSession("ses-1");
    assert.equal(calls[0]?.url, "http://127.0.0.1:3000/v1/sessions/ses-1");
    assert.equal(calls[0]?.headers["steel-api-key"], undefined);
    assert.equal(session?.status, "running");
    assert.equal(session?.region, "self-hosted");
  });

  it("uses Steel Cloud when only an API key is set", async () => {
    delete process.env.STEEL_API_URL;
    process.env.STEEL_API_KEY = "steel-key";
    stubFetch(() => jsonResponse(200, { id: "ses-c", status: "live" }));
    await new SteelProvider().getSession("ses-c");
    assert.equal(calls[0]?.url, "https://api.steel.dev/v1/sessions/ses-c");
    assert.equal(calls[0]?.headers["steel-api-key"], "steel-key");
  });

  it("maps live to running and unknown to error", () => {
    assert.equal(mapSteelStatus("live"), "running");
    assert.equal(mapSteelStatus("pending"), "pending");
    assert.equal(mapSteelStatus("released"), "ended");
    assert.throws(() => mapSteelStatus("mystery"), (err: unknown) => codeOf(err) === "PROVIDER_UNKNOWN_STATUS");
  });

  it("does not send captcha solving and fails if the provider echoes it on", async () => {
    process.env.STEEL_API_URL = "http://127.0.0.1:3000";
    stubFetch((call) => {
      if (call.method === "POST") {
        const body = JSON.parse(call.body || "{}") as { solveCaptcha?: boolean; stealth?: boolean };
        assert.equal(body.solveCaptcha, false);
        assert.equal(body.stealth, false);
        return jsonResponse(200, { id: "ses-p", status: "live", solveCaptcha: true });
      }
      return jsonResponse(404, {});
    });
    await assert.rejects(
      () => new SteelProvider().createSession(sessionInput()),
      (err: unknown) => codeOf(err) === "PROVIDER_UNSUPPORTED_PRIVACY",
    );
  });

  it("issues the debug live view URL", async () => {
    process.env.STEEL_API_URL = "http://127.0.0.1:3000";
    stubFetch(() =>
      jsonResponse(200, {
        id: "ses-v",
        status: "live",
        debugUrl: "http://127.0.0.1:3000/v1/sessions/ses-v/debug",
      }),
    );
    const view = await new SteelProvider().issueControlView("ses-v", 3);
    assert.match(view.url, /\/debug\?interactive=true$/);
    assert.equal(view.writable, true);
    assert.equal(view.generation, 3);
  });

  it("treats missing config as not configured", async () => {
    delete process.env.STEEL_API_URL;
    delete process.env.STEEL_API_KEY;
    await assert.rejects(
      () => new SteelProvider().getSession("x"),
      (err: unknown) => codeOf(err) === "PROVIDER_NOT_CONFIGURED",
    );
  });
});
