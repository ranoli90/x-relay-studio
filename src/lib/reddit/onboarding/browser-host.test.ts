import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OnboardingError } from "./types.ts";
import { loadOnboardingSchema, toSql } from "./test-schema.ts";
import {
  disconnectSteelHost,
  hydrateSteelFromStore,
  maskSteelKey,
  parseSteelApiKey,
  probeSteelCloud,
  publicSteelHost,
  saveSteelHost,
  STEEL_CLOUD_BASE,
} from "./browser-host.ts";
import { decryptV2 } from "./vault.ts";
import { steelApiKey } from "./config.ts";

const ENV_KEYS = ["STEEL_API_KEY", "STEEL_API_URL", "STEEL_HOST_PERSIST_PATH", "STEEL_HOST_PERSIST", "VERCEL"] as const;
const snapshot: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) snapshot[key] = process.env[key];

const realFetch = globalThis.fetch;
let calls: { url: string; method: string; headerKey?: string }[] = [];

function stubFetch(status: number) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: (init?.method || "GET").toUpperCase(), headerKey: headers.get("steel-api-key") ?? undefined });
    return new Response("{}", { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
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

describe("steel host setup", () => {
  it("masks keys and rejects junk", () => {
    assert.equal(maskSteelKey("steel-live-abcdefghijklmnopqrstuvwxyz"), "••••wxyz");
    assert.throws(() => parseSteelApiKey("short"), OnboardingError);
    assert.throws(() => parseSteelApiKey("https://app.steel.dev/settings/api-keys"), OnboardingError);
  });

  it("treats a session list 200 as a valid key", async () => {
    stubFetch(200);
    await probeSteelCloud("steel-live-abcdefghijklmnopqrstuvwxyz");
    assert.equal(calls[0]?.url, `${STEEL_CLOUD_BASE}/v1/sessions`);
    assert.equal(calls[0]?.headerKey, "steel-live-abcdefghijklmnopqrstuvwxyz");
  });

  it("rejects 401 without saving", async () => {
    stubFetch(401);
    await assert.rejects(
      () => probeSteelCloud("steel-live-abcdefghijklmnopqrstuvwxyz"),
      (err: unknown) => err instanceof OnboardingError && err.code === "STEEL_KEY_INVALID",
    );
  });

  it("encrypts the key, never returns it, and hydrates process env from the store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "steel-host-"));
    process.env.STEEL_HOST_PERSIST_PATH = join(dir, "steel.env");
    delete process.env.STEEL_API_KEY;
    stubFetch(200);
    const pg = new PGlite();
    await loadOnboardingSchema(pg);
    const sql = toSql(pg);
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-steel-host-v2";
    const saved = await saveSteelHost(sql, "user-a", "steel-live-abcdefghijklmnopqrstuvwxyz");
    assert.equal(saved.connected, true);
    assert.equal(saved.source, "saved");
    assert.equal(saved.hint, "••••wxyz");
    assert.equal(JSON.stringify(saved).includes("steel-live-abcdefghijklmnopqrstuvwxyz"), false);

    const rows = await sql.query<{ api_key_ciphertext: string }>(
      "select api_key_ciphertext from reddit_browser_hosts where user_id = $1",
      ["user-a"],
    );
    const blob = rows[0]?.api_key_ciphertext ?? "";
    assert.ok(blob.startsWith("v2."));
    assert.equal(
      decryptV2(blob, { userId: "user-a", recordId: "user-a", purpose: "browser_host_key" }),
      "steel-live-abcdefghijklmnopqrstuvwxyz",
    );
    assert.equal(steelApiKey(), "steel-live-abcdefghijklmnopqrstuvwxyz");
    const persist = readFileSync(process.env.STEEL_HOST_PERSIST_PATH, "utf8");
    assert.match(persist, /STEEL_API_KEY=steel-live-abcdefghijklmnopqrstuvwxyz/);

    delete process.env.STEEL_API_KEY;
    const hydrated = await hydrateSteelFromStore(sql, "user-a");
    assert.equal(hydrated, true);
    assert.equal(steelApiKey(), "steel-live-abcdefghijklmnopqrstuvwxyz");

    const after = await disconnectSteelHost(sql, "user-a");
    assert.equal(after.connected, false);
    assert.equal(after.hint, null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not leak the key in public status when disconnected", async () => {
    const pg = new PGlite();
    await loadOnboardingSchema(pg);
    delete process.env.STEEL_API_KEY;
    const status = await publicSteelHost(toSql(pg), "user-b", true);
    assert.equal(status.connected, false);
    assert.equal(status.previewUsesLocal, true);
    assert.equal(status.signupUrl, "https://app.steel.dev");
  });
});
