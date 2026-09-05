import {
  assertPolicySupported,
  BrowserProviderError,
  DEFAULT_SESSION_POLICY,
  type BrowserProvider,
  type BrowserSession,
  type ControlView,
  type CreateSessionInput,
} from "../provider.ts";

const API = "https://www.browserbase.com/v1";

function creds() {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  const region = process.env.BROWSERBASE_REGION?.trim() || "us-west-2";
  if (!apiKey || !projectId) {
    throw new BrowserProviderError("PROVIDER_NOT_CONFIGURED", "Browserbase is not configured.");
  }
  return { apiKey, projectId, region };
}

async function bb<T>(
  path: string,
  init: RequestInit & { apiKey: string },
): Promise<{ status: number; json: T; retryAfter?: number }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": init.apiKey,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const retryAfter = res.headers.get("retry-after");
  let json = {} as T;
  try {
    json = (await res.json()) as T;
  } catch {
    json = {} as T;
  }
  if (res.status === 429) {
    throw new BrowserProviderError(
      "PROVIDER_RATE_LIMITED",
      "Browserbase asked us to wait.",
      retryAfter ? Number(retryAfter) || 30 : 30,
    );
  }
  return { status: res.status, json, retryAfter: retryAfter ? Number(retryAfter) : undefined };
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
        body: JSON.stringify({
          projectId,
          name: `reddit-onboarding:${opts.environmentId}:${opts.jobId}`,
        }),
      },
    );
    if (status >= 400 || !json.id) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Could not create an isolated browser context.");
    }
    return { contextId: json.id };
  }

  async createSession(input: CreateSessionInput): Promise<BrowserSession> {
    assertPolicySupported(input.policy);
    const { apiKey, projectId, region } = creds();
    const body = {
      projectId,
      timeout: input.policy.timeoutSeconds,
      keepAlive: input.policy.keepAlive,
      region,
      browserSettings: {
        context: input.contextId ? { id: input.contextId, persist: false } : undefined,
        solveCaptchas: false,
        recordSession: false,
        logSession: false,
        advancedStealth: false,
      },
      userMetadata: {
        jobId: input.jobId,
        allocationIntentId: input.allocationIntentId,
        generation: String(input.generation),
      },
    };
    const { status, json } = await bb<{
      id?: string;
      connectUrl?: string;
      status?: string;
      expiresAt?: string;
      region?: string;
    }>("/sessions", { method: "POST", apiKey, body: JSON.stringify(body) });
    if (status >= 400 || !json.id) {
      if (status === 0 || status >= 500) {
        throw new BrowserProviderError("SESSION_AMBIGUOUS", "Session create did not confirm. Reconcile before retrying.");
      }
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Browserbase rejected the session.");
    }
    const required = ["solveCaptchas", "recordSession", "logSession", "advancedStealth"];
    for (const key of required) {
      if (!(key in (body.browserSettings as object))) {
        throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Privacy setting omitted.");
      }
    }
    return {
      sessionId: json.id,
      contextId: input.contextId ?? null,
      connectUrl: json.connectUrl || "",
      expiresAt: json.expiresAt || new Date(Date.now() + input.policy.timeoutSeconds * 1000).toISOString(),
      projectId,
      region: json.region || region,
      status: "running",
    };
  }

  async getSession(sessionId: string) {
    const { apiKey, projectId, region } = creds();
    const { status, json } = await bb<{
      id?: string;
      status?: string;
      connectUrl?: string;
      contextId?: string;
      expiresAt?: string;
      region?: string;
    }>(`/sessions/${encodeURIComponent(sessionId)}`, { method: "GET", apiKey });
    if (status === 404) return null;
    if (status >= 400 || !json.id) {
      throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Could not read session status.");
    }
    const ended = /stopped|ended|completed|error/i.test(json.status || "");
    const sessionStatus: BrowserSession["status"] = ended
      ? "ended"
      : json.status === "releasing"
        ? "releasing"
        : "running";
    return {
      sessionId: json.id,
      contextId: json.contextId ?? null,
      connectUrl: json.connectUrl || "",
      expiresAt: json.expiresAt || new Date().toISOString(),
      projectId,
      region: json.region || region,
      status: sessionStatus,
    };
  }

  async requestRelease(sessionId: string) {
    const { apiKey } = creds();
    const { status } = await bb(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      apiKey,
      body: JSON.stringify({ projectId: creds().projectId, status: "REQUEST_RELEASE" }),
    });
    if (status >= 400) return { accepted: false, ended: false };
    const current = await this.getSession(sessionId);
    return { accepted: true, ended: current?.status === "ended" };
  }

  async deleteContext(contextId: string) {
    const { apiKey } = creds();
    const { status } = await bb(`/contexts/${encodeURIComponent(contextId)}`, {
      method: "DELETE",
      apiKey,
    });
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

  async revokeControlView() {
    return { revoked: false };
  }

  async usage() {
    return { seconds: 0 };
  }
}

export const browserbaseProvider = new BrowserbaseProvider();

export { DEFAULT_SESSION_POLICY };
