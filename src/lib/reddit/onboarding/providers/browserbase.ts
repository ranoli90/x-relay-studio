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

const API = "https://api.browserbase.com/v1";
const REQUEST_TIMEOUT_MS = 20_000;

type BrowserbaseSessionPayload = {
  id?: unknown;
  status?: unknown;
  connectUrl?: unknown;
  contextId?: unknown;
  expiresAt?: unknown;
  region?: unknown;
  projectId?: unknown;
  duration?: unknown;
  durationSeconds?: unknown;
  avgDuration?: unknown;
  seconds?: unknown;
  browserSettings?: unknown;
};

function creds() {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  const region = process.env.BROWSERBASE_REGION?.trim() || "us-west-2";
  if (!apiKey || !projectId) {
    throw new BrowserProviderError("PROVIDER_NOT_CONFIGURED", "Browserbase is not configured.");
  }
  return { apiKey, projectId, region };
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

function normalizeTransportError(err: unknown, sideEffecting: boolean): never {
  if (err instanceof BrowserProviderError) throw err;
  if (isAbortError(err)) {
    if (sideEffecting) {
      throw new BrowserProviderError(
        "SESSION_AMBIGUOUS",
        "Browserbase timed out after the request may have been accepted. Reconcile before retrying.",
      );
    }
    throw new BrowserProviderError("PROVIDER_TIMEOUT", "Browserbase timed out.");
  }
  if (err instanceof TypeError) {
    if (sideEffecting) {
      throw new BrowserProviderError(
        "SESSION_AMBIGUOUS",
        "Browserbase network error after the request may have been accepted. Reconcile before retrying.",
      );
    }
    throw new BrowserProviderError("PROVIDER_TIMEOUT", "Browserbase network error.");
  }
  throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Browserbase request failed.");
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

export function mapBrowserbaseStatus(raw: unknown): BrowserSession["status"] {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new BrowserProviderError("PROVIDER_UNKNOWN_STATUS", "Browserbase status is missing.");
  }
  switch (raw.toUpperCase()) {
    case "PENDING":
      return "pending";
    case "RUNNING":
      return "running";
    case "ERROR":
    case "TIMED_OUT":
    case "COMPLETED":
      return "ended";
    default:
      throw new BrowserProviderError(
        "PROVIDER_UNKNOWN_STATUS",
        `Browserbase status ${raw} is not a known running state.`,
      );
  }
}

function observedUsage(json: BrowserbaseSessionPayload): UsageReport {
  const seconds =
    readNumericSeconds(json.durationSeconds) ??
    readNumericSeconds(json.duration) ??
    readNumericSeconds(json.avgDuration) ??
    readNumericSeconds(json.seconds);
  if (seconds === null) return { seconds: null, unknown: true };
  return { seconds, unknown: false };
}

function privacyEchoedOn(json: BrowserbaseSessionPayload): boolean {
  const settings = asRecord(json.browserSettings);
  if (!settings) return false;
  const keys = ["recordSession", "logSession", "solveCaptchas", "advancedStealth", "captchaSolving"];
  return keys.some((key) => settings[key] === true);
}

async function bb<T>(
  path: string,
  init: RequestInit & { apiKey: string; sideEffecting?: boolean; allowEmpty?: boolean },
): Promise<{ status: number; json: T }> {
  const sideEffecting = Boolean(init.sideEffecting);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": init.apiKey,
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
      "Browserbase asked us to wait.",
      parseRetryAfter(res.headers.get("retry-after")),
    );
  }

  const text = await res.text();
  if (!text.trim()) {
    if (res.status === 204 || res.status === 404 || init.allowEmpty) {
      return { status: res.status, json: {} as T };
    }
    if (res.status >= 200 && res.status < 300) {
      if (sideEffecting) {
        throw new BrowserProviderError("SESSION_AMBIGUOUS", "Browserbase returned an empty body.");
      }
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Browserbase returned invalid JSON.");
    }
    return { status: res.status, json: {} as T };
  }

  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    if (res.status >= 200 && res.status < 300) {
      if (sideEffecting) {
        throw new BrowserProviderError("SESSION_AMBIGUOUS", "Browserbase returned invalid JSON.");
      }
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Browserbase returned invalid JSON.");
    }
    if (res.status >= 500) {
      throw new BrowserProviderError(
        sideEffecting ? "SESSION_AMBIGUOUS" : "PROVIDER_UNAVAILABLE",
        "Browserbase returned invalid JSON.",
      );
    }
    return { status: res.status, json: {} as T };
  }
  return { status: res.status, json };
}

function toSession(
  json: BrowserbaseSessionPayload,
  fallback: { contextId: string | null; projectId: string; region: string; timeoutSeconds: number },
): BrowserSession {
  if (typeof json.id !== "string" || !json.id) {
    throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Browserbase session is missing an id.");
  }
  const status = mapBrowserbaseStatus(json.status);
  return {
    sessionId: json.id,
    contextId: typeof json.contextId === "string" ? json.contextId : fallback.contextId,
    connectUrl: typeof json.connectUrl === "string" ? json.connectUrl : "",
    expiresAt:
      typeof json.expiresAt === "string" && json.expiresAt
        ? json.expiresAt
        : new Date(Date.now() + fallback.timeoutSeconds * 1000).toISOString(),
    projectId: typeof json.projectId === "string" && json.projectId ? json.projectId : fallback.projectId,
    region: typeof json.region === "string" && json.region ? json.region : fallback.region,
    status,
  };
}

export class BrowserbaseProvider implements BrowserProvider {
  readonly name = "browserbase" as const;

  async createContext(opts: { jobId: string; userId: string; environmentId: string }) {
    const { apiKey, projectId } = creds();
    const { status, json } = await bb<{ id?: string; error?: string }>(
      "/contexts",
      {
        method: "POST",
        apiKey,
        sideEffecting: true,
        body: JSON.stringify({
          projectId,
          name: `reddit-onboarding:${opts.environmentId}:${opts.jobId}`,
        }),
      },
    );
    if (status >= 500) {
      throw new BrowserProviderError("SESSION_AMBIGUOUS", "Context create did not confirm. Reconcile before retrying.");
    }
    if (status >= 400 || !json.id) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Could not create an isolated browser context.");
    }
    return { contextId: json.id };
  }

  async createSession(input: CreateSessionInput): Promise<BrowserSession> {
    assertPolicySupported(input.policy);
    const { apiKey, projectId, region } = creds();
    const persist = input.persist === true;
    const browserSettings = {
      context: input.contextId ? { id: input.contextId, persist } : undefined,
      solveCaptchas: false,
      recordSession: false,
      logSession: false,
      advancedStealth: false,
    };
    if (
      browserSettings.recordSession !== false ||
      browserSettings.logSession !== false ||
      browserSettings.solveCaptchas !== false ||
      browserSettings.advancedStealth !== false
    ) {
      throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Requested privacy option is unsupported.");
    }
    const body = {
      projectId,
      timeout: input.policy.timeoutSeconds,
      keepAlive: input.policy.keepAlive,
      region,
      browserSettings,
      userMetadata: {
        jobId: input.jobId,
        allocationIntentId: input.allocationIntentId,
        generation: String(input.generation),
      },
    };
    const { status, json } = await bb<BrowserbaseSessionPayload>("/sessions", {
      method: "POST",
      apiKey,
      sideEffecting: true,
      body: JSON.stringify(body),
    });
    if (status >= 500) {
      throw new BrowserProviderError("SESSION_AMBIGUOUS", "Session create did not confirm. Reconcile before retrying.");
    }
    if (status >= 400 || typeof json.id !== "string" || !json.id) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Browserbase rejected the session.");
    }
    if (privacyEchoedOn(json)) {
      throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Provider echoed disallowed privacy settings.");
    }
    return toSession(json, {
      contextId: input.contextId ?? null,
      projectId,
      region,
      timeoutSeconds: input.policy.timeoutSeconds,
    });
  }

  async getSession(sessionId: string) {
    const { apiKey, projectId, region } = creds();
    const { status, json } = await bb<BrowserbaseSessionPayload>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET", apiKey },
    );
    if (status === 404) return null;
    if (status >= 500) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Could not read session status.");
    }
    if (status >= 400 || typeof json.id !== "string" || !json.id) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Could not read session status.");
    }
    return toSession(json, {
      contextId: typeof json.contextId === "string" ? json.contextId : null,
      projectId,
      region,
      timeoutSeconds: 0,
    });
  }

  async requestRelease(sessionId: string) {
    const { apiKey, projectId } = creds();
    const { status } = await bb(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      apiKey,
      sideEffecting: true,
      allowEmpty: true,
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
    });
    if (status === 404) return { accepted: true, ended: true };
    if (status >= 500) {
      throw new BrowserProviderError("SESSION_AMBIGUOUS", "Release request did not confirm.");
    }
    if (status >= 400) return { accepted: false, ended: false };
    const current = await this.getSession(sessionId);
    return { accepted: true, ended: current?.status === "ended" || current === null };
  }

  async deleteContext(contextId: string) {
    const { apiKey } = creds();
    const { status } = await bb(`/contexts/${encodeURIComponent(contextId)}`, {
      method: "DELETE",
      apiKey,
      allowEmpty: true,
    });
    if (status === 404) return { deleted: true };
    if (status >= 500) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Context delete did not confirm.");
    }
    return { deleted: status < 400 };
  }

  async attachConnection(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (!session?.connectUrl) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "No connection URL.");
    }
    return { connectUrl: session.connectUrl };
  }

  async issueControlView(sessionId: string, generation: number): Promise<ControlView> {
    const { apiKey } = creds();
    const { status, json } = await bb<{ debuggerFullscreenUrl?: string; debuggerUrl?: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/debug`,
      { method: "GET", apiKey },
    );
    if (status >= 400 || !(json.debuggerFullscreenUrl || json.debuggerUrl)) {
      throw new BrowserProviderError("CONTROL_NOT_READY", "Live view is not available.");
    }
    return {
      url: json.debuggerFullscreenUrl || json.debuggerUrl || "",
      writable: true,
      generation,
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
    };
  }

  async revokeControlView(_sessionId: string, _generation: number): Promise<RevokeControlResult> {
    // Browserbase does not document control-URL revocation. Local expiry is not confirmation.
    return { revoked: false, verified: false };
  }

  async usage(sessionId: string): Promise<UsageReport> {
    const { apiKey } = creds();
    const { status, json } = await bb<BrowserbaseSessionPayload>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET", apiKey },
    );
    if (status === 404) return { seconds: null, unknown: true };
    if (status >= 400) return { seconds: null, unknown: true };
    return observedUsage(json);
  }
}

export const browserbaseProvider = new BrowserbaseProvider();

export { DEFAULT_SESSION_POLICY };
