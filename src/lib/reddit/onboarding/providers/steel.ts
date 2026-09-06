import {
  assertPolicySupported,
  BrowserProviderError,
  DEFAULT_SESSION_POLICY,
  type BrowserProvider,
  type BrowserSession,
  type ControlView,
  type CreateSessionInput,
  type RevokeControlResult,
  type UsageReport,
} from "../provider.ts";
import { steelApiBaseUrl, steelApiKey } from "../config.ts";

const REQUEST_TIMEOUT_MS = 20_000;

type SteelSessionPayload = {
  id?: unknown;
  status?: unknown;
  websocketUrl?: unknown;
  connectUrl?: unknown;
  debugUrl?: unknown;
  sessionViewerUrl?: unknown;
  contextId?: unknown;
  timeout?: unknown;
  duration?: unknown;
  durationSeconds?: unknown;
};

function creds() {
  const baseUrl = steelApiBaseUrl();
  if (!baseUrl) {
    throw new BrowserProviderError("PROVIDER_NOT_CONFIGURED", "Steel is not configured. Set STEEL_API_URL for a self-hosted instance, or STEEL_API_KEY for Steel Cloud.");
  }
  return { baseUrl, apiKey: steelApiKey() };
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

function normalizeTransportError(err: unknown, sideEffecting: boolean): never {
  if (err instanceof BrowserProviderError) throw err;
  if (isAbortError(err)) {
    throw new BrowserProviderError(
      sideEffecting ? "SESSION_AMBIGUOUS" : "PROVIDER_TIMEOUT",
      sideEffecting
        ? "Steel timed out after the request may have been accepted. Reconcile before retrying."
        : "Steel timed out.",
    );
  }
  if (err instanceof TypeError) {
    throw new BrowserProviderError(
      sideEffecting ? "SESSION_AMBIGUOUS" : "PROVIDER_TIMEOUT",
      sideEffecting
        ? "Steel network error after the request may have been accepted. Reconcile before retrying."
        : "Steel network error.",
    );
  }
  throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Steel request failed.");
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 30;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds);
  const when = Date.parse(header);
  if (Number.isFinite(when)) {
    const delta = Math.ceil((when - Date.now()) / 1000);
    if (delta > 0) return delta;
  }
  return 30;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNumericSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function mapSteelStatus(raw: unknown): BrowserSession["status"] {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new BrowserProviderError("PROVIDER_UNKNOWN_STATUS", "Steel status is missing.");
  }
  switch (raw.toLowerCase()) {
    case "pending":
    case "creating":
    case "queued":
      return "pending";
    case "live":
    case "running":
    case "active":
    case "ready":
      return "running";
    case "releasing":
      return "releasing";
    case "released":
    case "idle":
    case "error":
    case "failed":
    case "timed_out":
    case "timeout":
    case "completed":
    case "stopped":
    case "ended":
      return "ended";
    default:
      throw new BrowserProviderError(
        "PROVIDER_UNKNOWN_STATUS",
        `Steel status ${raw} is not a known running state.`,
      );
  }
}

function privacyEchoedOn(json: SteelSessionPayload): boolean {
  const rec = asRecord(json);
  if (!rec) return false;
  const keys = ["solveCaptcha", "solveCaptchas", "captchaSolving", "stealth", "advancedStealth", "recordSession", "logSession"];
  return keys.some((key) => rec[key] === true);
}

async function steel<T>(
  path: string,
  init: RequestInit & { sideEffecting?: boolean; allowEmpty?: boolean },
): Promise<{ status: number; json: T }> {
  const { baseUrl, apiKey } = creds();
  const sideEffecting = Boolean(init.sideEffecting);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "steel-api-key": apiKey } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    normalizeTransportError(err, sideEffecting);
  }

  if (res.status === 429) {
    throw new BrowserProviderError(
      "PROVIDER_RATE_LIMITED",
      "Steel asked us to wait.",
      parseRetryAfter(res.headers.get("retry-after")),
    );
  }

  const text = await res.text();
  if (!text.trim()) {
    if (res.status === 204 || res.status === 404 || init.allowEmpty) {
      return { status: res.status, json: {} as T };
    }
    if (res.status >= 200 && res.status < 300) {
      throw new BrowserProviderError(
        sideEffecting ? "SESSION_AMBIGUOUS" : "PROVIDER_UNAVAILABLE",
        "Steel returned an empty body.",
      );
    }
    return { status: res.status, json: {} as T };
  }

  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    if (res.status >= 200 && res.status < 300) {
      throw new BrowserProviderError(
        sideEffecting ? "SESSION_AMBIGUOUS" : "PROVIDER_UNAVAILABLE",
        "Steel returned invalid JSON.",
      );
    }
    if (res.status >= 500) {
      throw new BrowserProviderError(
        sideEffecting ? "SESSION_AMBIGUOUS" : "PROVIDER_UNAVAILABLE",
        "Steel returned invalid JSON.",
      );
    }
    return { status: res.status, json: {} as T };
  }
  return { status: res.status, json };
}

function toSession(
  json: SteelSessionPayload,
  fallback: { contextId: string | null; timeoutSeconds: number },
): BrowserSession {
  if (typeof json.id !== "string" || !json.id) {
    throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Steel session is missing an id.");
  }
  const status = mapSteelStatus(json.status);
  const connect =
    (typeof json.websocketUrl === "string" && json.websocketUrl) ||
    (typeof json.connectUrl === "string" && json.connectUrl) ||
    "";
  return {
    sessionId: json.id,
    contextId: typeof json.contextId === "string" ? json.contextId : fallback.contextId,
    connectUrl: connect,
    expiresAt: new Date(Date.now() + fallback.timeoutSeconds * 1000).toISOString(),
    projectId: "steel",
    region: "self-hosted",
    status,
  };
}

export class SteelProvider implements BrowserProvider {
  readonly name = "steel" as const;

  async createContext(opts: { jobId: string; userId: string; environmentId: string }) {
    creds();
    return { contextId: `steel-ctx:${opts.environmentId}:${opts.jobId}` };
  }

  async createSession(input: CreateSessionInput): Promise<BrowserSession> {
    assertPolicySupported(input.policy);
    const body = {
      timeout: input.policy.timeoutSeconds,
      solveCaptcha: false,
      stealth: false,
      userMetadata: {
        jobId: input.jobId,
        allocationIntentId: input.allocationIntentId,
        generation: String(input.generation),
      },
    };
    const { status, json } = await steel<SteelSessionPayload>("/v1/sessions", {
      method: "POST",
      sideEffecting: true,
      body: JSON.stringify(body),
    });
    if (status >= 500) {
      throw new BrowserProviderError("SESSION_AMBIGUOUS", "Steel session create did not confirm. Reconcile before retrying.");
    }
    if (status >= 400 || typeof json.id !== "string" || !json.id) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Steel rejected the session.");
    }
    if (privacyEchoedOn(json)) {
      throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Steel echoed disallowed privacy settings.");
    }
    return toSession(json, {
      contextId: input.contextId ?? null,
      timeoutSeconds: input.policy.timeoutSeconds,
    });
  }

  async getSession(sessionId: string) {
    const { status, json } = await steel<SteelSessionPayload>(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
    });
    if (status === 404) return null;
    if (status >= 500) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Could not read Steel session status.");
    }
    if (status >= 400 || typeof json.id !== "string" || !json.id) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Could not read Steel session status.");
    }
    return toSession(json, { contextId: typeof json.contextId === "string" ? json.contextId : null, timeoutSeconds: 0 });
  }

  async requestRelease(sessionId: string) {
    const encoded = encodeURIComponent(sessionId);
    const released = await steel(`/v1/sessions/${encoded}/release`, {
      method: "POST",
      sideEffecting: true,
      allowEmpty: true,
      body: "{}",
    }).catch(() => null);
    if (!released || released.status >= 400) {
      const deleted = await steel(`/v1/sessions/${encoded}`, {
        method: "DELETE",
        sideEffecting: true,
        allowEmpty: true,
      });
      if (deleted.status === 404) return { accepted: true, ended: true };
      if (deleted.status >= 500) {
        throw new BrowserProviderError("SESSION_AMBIGUOUS", "Steel release did not confirm.");
      }
      if (deleted.status >= 400) return { accepted: false, ended: false };
    }
    const current = await this.getSession(sessionId);
    return { accepted: true, ended: current?.status === "ended" || current === null };
  }

  async deleteContext(_contextId: string) {
    return { deleted: true };
  }

  async attachConnection(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (!session?.connectUrl) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "No Steel connection URL.");
    }
    return { connectUrl: session.connectUrl };
  }

  async issueControlView(sessionId: string, generation: number): Promise<ControlView> {
    const { status, json } = await steel<SteelSessionPayload>(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
    });
    if (status >= 400) {
      throw new BrowserProviderError("CONTROL_NOT_READY", "Steel live view is not available.");
    }
    const url =
      (typeof json.debugUrl === "string" && json.debugUrl) ||
      (typeof json.sessionViewerUrl === "string" && json.sessionViewerUrl) ||
      "";
    if (!url) {
      throw new BrowserProviderError("CONTROL_NOT_READY", "Steel live view is not available.");
    }
    const interactive = url.includes("?") ? `${url}&interactive=true` : `${url}?interactive=true`;
    return {
      url: interactive,
      writable: true,
      generation,
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
    };
  }

  async revokeControlView(_sessionId: string, _generation: number): Promise<RevokeControlResult> {
    return { revoked: false, verified: false };
  }

  async usage(sessionId: string): Promise<UsageReport> {
    const { status, json } = await steel<SteelSessionPayload>(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
    });
    if (status >= 400) return { seconds: null, unknown: true };
    const seconds = readNumericSeconds(json.durationSeconds) ?? readNumericSeconds(json.duration);
    if (seconds === null) return { seconds: null, unknown: true };
    return { seconds, unknown: false };
  }
}

export const steelProvider = new SteelProvider();

export { DEFAULT_SESSION_POLICY };
