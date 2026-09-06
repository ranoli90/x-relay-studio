import {
  assertPolicySupported,
  BrowserProviderError,
  type BrowserProvider,
  type BrowserSession,
  type ControlView,
  type CreateSessionInput,
  type RevokeControlResult,
  type UsageReport,
} from "../provider.ts";
import { fixtureSignupUrl } from "../controller.ts";
import { onboardingFixtureEnabled } from "../config.ts";
import { REVIEWED_SIGNUP_URL } from "../types.ts";

export type LocalInput = {
  action: "click" | "type" | "key";
  x?: number;
  y?: number;
  text?: string;
  key?: string;
};

export type LocalPageHandle = {
  screenshot(): Promise<Buffer>;
  click(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  url(): string;
};

export type LocalLauncher = (opts: {
  sessionId: string;
  startUrl: string;
}) => Promise<{ page: LocalPageHandle; close(): Promise<void> }>;

type LocalSession = BrowserSession & {
  userId?: string;
  createdAtMs: number;
  controlGen?: number;
  writable?: boolean;
  handle?: { page: LocalPageHandle; close(): Promise<void> };
};

type LocalState = {
  sessions: Map<string, LocalSession>;
  contexts: Map<string, { userId: string }>;
  allocations: Map<string, string>;
};

const g = globalThis as typeof globalThis & { __redditLocalBrowser__?: LocalState };
function state(): LocalState {
  g.__redditLocalBrowser__ ??= { sessions: new Map(), contexts: new Map(), allocations: new Map() };
  return g.__redditLocalBrowser__;
}

export function resetLocalProvider() {
  g.__redditLocalBrowser__ = { sessions: new Map(), contexts: new Map(), allocations: new Map() };
}

export function getLocalSession(sessionId: string): LocalSession | null {
  return state().sessions.get(sessionId) ?? null;
}

async function defaultLauncher(opts: { sessionId: string; startUrl: string }) {
  let chromium: { launch: (options?: Record<string, unknown>) => Promise<unknown> };
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new BrowserProviderError(
      "PROVIDER_NOT_CONFIGURED",
      "Playwright is not installed on this worker. Use Steel self-host or install Playwright Chromium.",
    );
  }
  const browser = (await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })) as {
    newContext: (opts?: Record<string, unknown>) => Promise<{
      newPage: () => Promise<{
        setViewportSize: (size: { width: number; height: number }) => Promise<void>;
        goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
        screenshot: (opts?: Record<string, unknown>) => Promise<Buffer>;
        mouse: { click: (x: number, y: number) => Promise<void> };
        keyboard: { type: (text: string, opts?: Record<string, unknown>) => Promise<void>; press: (key: string) => Promise<void> };
        url: () => string;
      }>;
      close: () => Promise<void>;
    }>;
    close: () => Promise<void>;
  };
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  const page = await context.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(opts.startUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  return {
    page: {
      screenshot: () => page.screenshot({ type: "jpeg", quality: 50 }),
      click: (x: number, y: number) => page.mouse.click(x, y),
      type: (text: string) => page.keyboard.type(text, { delay: 15 }),
      press: (key: string) => page.keyboard.press(key),
      url: () => page.url(),
    },
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

function publicSession(s: LocalSession): BrowserSession {
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

function startUrl(): string {
  return onboardingFixtureEnabled() ? fixtureSignupUrl() : REVIEWED_SIGNUP_URL;
}

export class LocalBrowserProvider implements BrowserProvider {
  readonly name = "local" as const;
  private readonly launch: LocalLauncher;
  constructor(launch: LocalLauncher = defaultLauncher) {
    this.launch = launch;
  }

  async createContext(opts: { jobId: string; userId: string; environmentId: string }) {
    const contextId = `local-ctx-${opts.jobId}`;
    state().contexts.set(contextId, { userId: opts.userId });
    return { contextId };
  }

  async createSession(input: CreateSessionInput): Promise<BrowserSession> {
    if (process.env.VERCEL) {
      throw new BrowserProviderError("PROVIDER_NOT_CONFIGURED", "Local Chromium cannot run on Vercel. Use Steel on a worker host.");
    }
    assertPolicySupported(input.policy);
    const existing = state().allocations.get(input.allocationIntentId);
    if (existing) {
      const session = state().sessions.get(existing);
      if (session && session.status === "running") return publicSession(session);
    }
    const sessionId = `local-ses-${input.allocationIntentId}`;
    const handle = await this.launch({ sessionId, startUrl: startUrl() });
    const session: LocalSession = {
      sessionId,
      contextId: input.contextId ?? null,
      connectUrl: `local://session/${sessionId}`,
      expiresAt: new Date(Date.now() + input.policy.timeoutSeconds * 1000).toISOString(),
      projectId: "local-chromium",
      region: "self-hosted",
      status: "running",
      createdAtMs: Date.now(),
      handle,
      writable: false,
    };
    state().sessions.set(sessionId, session);
    state().allocations.set(input.allocationIntentId, sessionId);
    return publicSession(session);
  }

  async getSession(sessionId: string) {
    const s = state().sessions.get(sessionId);
    return s ? publicSession(s) : null;
  }

  async requestRelease(sessionId: string) {
    const s = state().sessions.get(sessionId);
    if (!s) return { accepted: true, ended: true };
    s.status = "ended";
    s.writable = false;
    await s.handle?.close().catch(() => undefined);
    s.handle = undefined;
    return { accepted: true, ended: true };
  }

  async deleteContext(contextId: string) {
    for (const session of state().sessions.values()) {
      if (session.contextId === contextId && session.status === "running") {
        await this.requestRelease(session.sessionId);
      }
    }
    state().contexts.delete(contextId);
    return { deleted: true };
  }

  async attachConnection(sessionId: string) {
    const s = state().sessions.get(sessionId);
    if (!s || s.status === "ended") throw new BrowserProviderError("PROVIDER_UNAVAILABLE", "Local session is gone.");
    return { connectUrl: s.connectUrl };
  }

  async issueControlView(sessionId: string, generation: number): Promise<ControlView> {
    const s = state().sessions.get(sessionId);
    if (!s || s.status !== "running") throw new BrowserProviderError("CONTROL_NOT_READY", "No local session.");
    s.controlGen = generation;
    s.writable = true;
    return {
      url: `local://view/${sessionId}`,
      writable: true,
      generation,
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
    };
  }

  async revokeControlView(sessionId: string, generation: number): Promise<RevokeControlResult> {
    const s = state().sessions.get(sessionId);
    if (!s) return { revoked: false, verified: false };
    if (s.controlGen === generation) {
      s.controlGen = generation + 1;
      s.writable = false;
    }
    return { revoked: true, verified: true };
  }

  async usage(sessionId: string): Promise<UsageReport> {
    const s = state().sessions.get(sessionId);
    if (!s) return { seconds: null, unknown: true };
    return { seconds: Math.max(0, Math.floor((Date.now() - s.createdAtMs) / 1000)), unknown: false };
  }

  async screenshot(sessionId: string): Promise<{ jpeg: Buffer; pageUrl: string }> {
    const s = state().sessions.get(sessionId);
    if (!s?.handle || s.status !== "running") {
      throw new BrowserProviderError("CONTROL_NOT_READY", "Local session is not running.");
    }
    const jpeg = await s.handle.page.screenshot();
    return { jpeg, pageUrl: s.handle.page.url() };
  }

  async input(sessionId: string, event: LocalInput): Promise<void> {
    const s = state().sessions.get(sessionId);
    if (!s?.handle || s.status !== "running") {
      throw new BrowserProviderError("CONTROL_NOT_READY", "Local session is not running.");
    }
    if (!s.writable) {
      throw new BrowserProviderError("CONTROL_NOT_READY", "Take control first.");
    }
    if (event.action === "click") {
      await s.handle.page.click(Number(event.x ?? 0), Number(event.y ?? 0));
      return;
    }
    if (event.action === "type" && event.text) {
      await s.handle.page.type(event.text);
      return;
    }
    if (event.action === "key" && event.key) {
      await s.handle.page.press(event.key);
    }
  }
}

export const localProvider = new LocalBrowserProvider();
