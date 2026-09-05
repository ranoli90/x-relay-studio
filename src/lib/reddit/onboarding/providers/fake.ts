import {
  assertPolicySupported,
  type BrowserProvider,
  type BrowserSession,
  type ControlView,
  type CreateSessionInput,
  BrowserProviderError,
} from "../provider.ts";

type FakeState = {
  sessions: Map<string, BrowserSession & { released?: boolean; controlGen?: number }>;
  contexts: Map<string, { userId: string; deleted?: boolean }>;
  allocations: Map<string, string>;
};

const g = globalThis as typeof globalThis & { __redditFakeBrowser__?: FakeState };
function state(): FakeState {
  g.__redditFakeBrowser__ ??= { sessions: new Map(), contexts: new Map(), allocations: new Map() };
  return g.__redditFakeBrowser__;
}

export function resetFakeProvider() {
  g.__redditFakeBrowser__ = { sessions: new Map(), contexts: new Map(), allocations: new Map() };
}

export class FakeBrowserProvider implements BrowserProvider {
  readonly name = "fake" as const;
  failPrivacy = false;
  delayCreateMs = 0;
  loseCreateResponse = false;
  releaseDoesNotEnd = false;

  async createContext(opts: { jobId: string; userId: string; environmentId: string }) {
    const contextId = `fake-ctx-${opts.jobId.slice(0, 8)}`;
    state().contexts.set(contextId, { userId: opts.userId });
    return { contextId };
  }

  async createSession(input: CreateSessionInput): Promise<BrowserSession> {
    assertPolicySupported(input.policy);
    if (this.failPrivacy) {
      throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Requested privacy option is unsupported.");
    }
    const existing = state().allocations.get(input.allocationIntentId);
    if (existing) {
      const session = state().sessions.get(existing);
      if (session) return publicSession(session);
    }
    if (this.delayCreateMs) await new Promise((r) => setTimeout(r, this.delayCreateMs));
    const sessionId = `fake-ses-${input.allocationIntentId.slice(0, 12)}`;
    const session: BrowserSession = {
      sessionId,
      contextId: input.contextId ?? null,
      connectUrl: `fake://session/${sessionId}`,
      expiresAt: new Date(Date.now() + input.policy.timeoutSeconds * 1000).toISOString(),
      projectId: "fake-project",
      region: "local",
      status: "running",
    };
    state().sessions.set(sessionId, session);
    state().allocations.set(input.allocationIntentId, sessionId);
    if (this.loseCreateResponse) {
      throw new BrowserProviderError("PROVIDER_TIMEOUT", "Create session response lost.");
    }
    return publicSession(session);
  }

  async getSession(sessionId: string) {
    const s = state().sessions.get(sessionId);
    return s ? publicSession(s) : null;
  }

  async requestRelease(sessionId: string) {
    const s = state().sessions.get(sessionId);
    if (!s) return { accepted: true, ended: true };
    s.status = this.releaseDoesNotEnd ? "releasing" : "ended";
    s.released = !this.releaseDoesNotEnd;
    return { accepted: true, ended: !this.releaseDoesNotEnd };
  }

  async deleteContext(contextId: string) {
    const live = [...state().sessions.values()].filter(
      (s) => s.contextId === contextId && s.status === "running",
    );
    if (live.length) {
      for (const s of live) {
        s.status = "ended";
      }
    }
    const ctx = state().contexts.get(contextId);
    if (ctx) ctx.deleted = true;
    return { deleted: true };
  }

  async attachConnection(sessionId: string) {
    const s = state().sessions.get(sessionId);
    if (!s || s.status === "ended") throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Session is gone.");
    return { connectUrl: s.connectUrl };
  }

  async issueControlView(sessionId: string, generation: number): Promise<ControlView> {
    const s = state().sessions.get(sessionId);
    if (!s) throw new BrowserProviderError("CONTROL_NOT_READY", "No session.");
    s.controlGen = generation;
    return {
      url: `fake://view/${sessionId}/${generation}`,
      writable: true,
      generation,
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
    };
  }

  async revokeControlView(sessionId: string, generation: number) {
    const s = state().sessions.get(sessionId);
    if (!s) return { revoked: true };
    if (s.controlGen === generation) s.controlGen = generation + 1;
    return { revoked: true };
  }

  async usage() {
    return { seconds: 1 };
  }
}

function publicSession(s: BrowserSession): BrowserSession {
  return {
    sessionId: s.sessionId,
    contextId: s.contextId,
    connectUrl: s.connectUrl,
    expiresAt: s.expiresAt,
    projectId: s.projectId,
    region: s.region,
    status: s.status,
  };
}

export const fakeProvider = new FakeBrowserProvider();
