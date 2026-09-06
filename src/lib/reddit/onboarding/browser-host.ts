import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OnboardingError, type SteelHostPublic } from "./types.ts";
import { encryptV2, decryptV2 } from "./vault.ts";
import { steelApiKey } from "./config.ts";
import type { SqlLike } from "./sql.ts";

export const STEEL_CLOUD_BASE = "https://api.steel.dev";
export const STEEL_CLOUD_SIGNUP_URL = "https://app.steel.dev";
export const STEEL_CLOUD_KEYS_URL = "https://app.steel.dev/settings/api-keys";

const ORIGINAL_ENV_KEY = (process.env.STEEL_API_KEY || "").trim();
let lastHydratedKey: string | null = null;

type HostRow = {
  user_id: string;
  provider: string;
  api_base_url: string;
  api_key_ciphertext: string;
  key_hint: string;
  status: string;
  last_verified_at: string | Date | null;
  last_error_code: string | null;
};

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function maskSteelKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < 8) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

export function parseSteelApiKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new OnboardingError("STEEL_KEY_INVALID", "Paste the Steel API key from Settings → API keys.");
  }
  const key = raw.trim();
  if (key.length < 16 || key.length > 200) {
    throw new OnboardingError("STEEL_KEY_INVALID", "That does not look like a Steel API key.");
  }
  if (/\s/.test(key) || /^https?:/i.test(key)) {
    throw new OnboardingError("STEEL_KEY_INVALID", "Paste only the API key, not a URL.");
  }
  return key;
}

export function steelPersistPath(): string {
  const override = process.env.STEEL_HOST_PERSIST_PATH?.trim();
  if (override) return override;
  return join(process.cwd(), ".data", "steel.env");
}

function shouldPersistFile(): boolean {
  if (process.env.VERCEL) return false;
  if (process.env.STEEL_HOST_PERSIST === "0") return false;
  if (process.env.NODE_ENV === "test" && !process.env.STEEL_HOST_PERSIST_PATH) return false;
  return true;
}

function writePersistFile(apiKey: string): void {
  if (!shouldPersistFile()) return;
  const path = steelPersistPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# generated; never commit\nSTEEL_API_KEY=${apiKey}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function deletePersistFile(): void {
  if (!shouldPersistFile()) return;
  try {
    unlinkSync(steelPersistPath());
  } catch {
    /* missing is fine */
  }
}

export function applySteelKeyToProcess(apiKey: string): void {
  process.env.STEEL_API_KEY = apiKey;
  lastHydratedKey = apiKey;
}

export function clearHydratedSteelKey(): void {
  if (lastHydratedKey && process.env.STEEL_API_KEY === lastHydratedKey) {
    if (ORIGINAL_ENV_KEY) process.env.STEEL_API_KEY = ORIGINAL_ENV_KEY;
    else delete process.env.STEEL_API_KEY;
  }
  lastHydratedKey = null;
}

function aad(userId: string) {
  return { userId, recordId: userId, purpose: "browser_host_key" as const };
}

const STEEL_HTTP_USER_AGENT = "x-relay-studio/reddit-onboarding";

export async function probeSteelCloud(apiKey: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${STEEL_CLOUD_BASE}/v1/sessions`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": STEEL_HTTP_USER_AGENT,
        "steel-api-key": apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new OnboardingError("STEEL_UNAVAILABLE", "Steel Cloud did not respond. Try again in a moment.");
  }
  if (res.status === 401) {
    throw new OnboardingError(
      "STEEL_KEY_INVALID",
      "That Steel key was rejected. Create a key at Steel → Settings → API keys.",
    );
  }
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    if (/error code:\s*1010|cloudflare/i.test(body)) {
      throw new OnboardingError("STEEL_UNAVAILABLE", "Steel Cloud blocked this network. Try again from the hosted worker.");
    }
    throw new OnboardingError(
      "STEEL_KEY_INVALID",
      "That Steel key was rejected. Create a key at Steel → Settings → API keys.",
    );
  }
  if (res.status === 429) return;
  if (res.status >= 500) {
    throw new OnboardingError("STEEL_UNAVAILABLE", "Steel Cloud did not respond. Try again in a moment.");
  }
  if (res.status === 404 || (res.status >= 200 && res.status < 300)) return;
  throw new OnboardingError("STEEL_KEY_INVALID", "Steel Cloud did not accept that key.");
}

export async function getSteelHostRow(sql: SqlLike, userId: string): Promise<HostRow | null> {
  const rows = await sql.query<HostRow>(
    `select user_id, provider, api_base_url, api_key_ciphertext, key_hint, status,
            last_verified_at, last_error_code
       from reddit_browser_hosts
      where user_id = $1
      limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export function emptySteelHost(previewUsesLocal: boolean): SteelHostPublic {
  return {
    connected: false,
    source: "none",
    hint: null,
    lastVerifiedAt: null,
    signupUrl: STEEL_CLOUD_SIGNUP_URL,
    keysUrl: STEEL_CLOUD_KEYS_URL,
    previewUsesLocal,
  };
}

export async function publicSteelHost(sql: SqlLike, userId: string, previewUsesLocal: boolean): Promise<SteelHostPublic> {
  const envKey = steelApiKey();
  const row = await getSteelHostRow(sql, userId).catch(() => null);
  if (row?.status === "connected" && row.api_key_ciphertext) {
    return {
      connected: true,
      source: ORIGINAL_ENV_KEY && envKey === ORIGINAL_ENV_KEY ? "env" : "saved",
      hint: row.key_hint,
      lastVerifiedAt: iso(row.last_verified_at),
      signupUrl: STEEL_CLOUD_SIGNUP_URL,
      keysUrl: STEEL_CLOUD_KEYS_URL,
      previewUsesLocal,
    };
  }
  if (envKey) {
    return {
      connected: true,
      source: "env",
      hint: maskSteelKey(envKey),
      lastVerifiedAt: null,
      signupUrl: STEEL_CLOUD_SIGNUP_URL,
      keysUrl: STEEL_CLOUD_KEYS_URL,
      previewUsesLocal,
    };
  }
  return emptySteelHost(previewUsesLocal);
}

export async function hydrateSteelFromStore(sql: SqlLike, userId: string): Promise<boolean> {
  if (steelApiKey()) return true;
  const row = await getSteelHostRow(sql, userId);
  if (!row || row.status !== "connected" || !row.api_key_ciphertext) return false;
  try {
    const key = decryptV2(row.api_key_ciphertext, aad(userId));
    applySteelKeyToProcess(key);
    return true;
  } catch {
    return false;
  }
}

export async function saveSteelHost(sql: SqlLike, userId: string, rawKey: unknown): Promise<SteelHostPublic> {
  const key = parseSteelApiKey(rawKey);
  await probeSteelCloud(key);
  const ciphertext = encryptV2(key, aad(userId));
  const hint = maskSteelKey(key);
  await sql.query(
    `insert into reddit_browser_hosts (
       user_id, provider, api_base_url, api_key_ciphertext, key_hint, status,
       last_verified_at, last_error_code, created_at, updated_at
     ) values ($1, 'steel_cloud', $2, $3, $4, 'connected', now(), null, now(), now())
     on conflict (user_id) do update set
       provider = excluded.provider,
       api_base_url = excluded.api_base_url,
       api_key_ciphertext = excluded.api_key_ciphertext,
       key_hint = excluded.key_hint,
       status = 'connected',
       last_verified_at = now(),
       last_error_code = null,
       updated_at = now()`,
    [userId, STEEL_CLOUD_BASE, ciphertext, hint],
  );
  applySteelKeyToProcess(key);
  writePersistFile(key);
  return publicSteelHost(sql, userId, false);
}

export async function disconnectSteelHost(sql: SqlLike, userId: string): Promise<SteelHostPublic> {
  await sql.query(`delete from reddit_browser_hosts where user_id = $1`, [userId]);
  clearHydratedSteelKey();
  deletePersistFile();
  return publicSteelHost(sql, userId, false);
}

/** Sandbox restart helper. Reads a gitignored persist file into process.env. */
export function loadPersistedSteelKey(): boolean {
  if (steelApiKey()) return true;
  if (process.env.VERCEL) return false;
  try {
    const text = readFileSync(steelPersistPath(), "utf8");
    const match = text.match(/^STEEL_API_KEY=(.+)$/m);
    const key = match?.[1]?.trim();
    if (!key) return false;
    applySteelKeyToProcess(key);
    return true;
  } catch {
    return false;
  }
}
