import type { BrowserProviderErrorCode, BrowserProviderName } from "./types.ts";

export type SessionPolicy = {
  timeoutSeconds: number;
  keepAlive: boolean;
  recordSession: false;
  logSession: false;
  captchaSolving: false;
  advancedStealth: false;
  validateCertificates: true;
};

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  timeoutSeconds: 900,
  keepAlive: true,
  recordSession: false,
  logSession: false,
  captchaSolving: false,
  advancedStealth: false,
  validateCertificates: true,
};

export type CreateSessionInput = {
  jobId: string;
  allocationIntentId: string;
  contextId?: string;
  generation: number;
  policy: SessionPolicy;
  /** Persist context state on session close. Default false; send true only when the caller asks. */
  persist?: boolean;
};

export type BrowserSession = {
  sessionId: string;
  contextId: string | null;
  connectUrl: string;
  expiresAt: string;
  projectId: string;
  region: string;
  status: "pending" | "running" | "releasing" | "ended";
  profileId?: string | null;
  debugUrl?: string | null;
};

export type ControlView = {
  url: string;
  writable: boolean;
  generation: number;
  expiresAt: string;
};

export type UsageReport = {
  seconds: number | null;
  unknown: boolean;
};

export type RevokeControlResult = {
  revoked: boolean;
  verified: boolean;
};

export class BrowserProviderError extends Error {
  code: BrowserProviderErrorCode;
  retryAfterSeconds?: number;
  constructor(code: BrowserProviderErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "BrowserProviderError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface BrowserProvider {
  readonly name: BrowserProviderName;
  createContext(opts: { jobId: string; userId: string; environmentId: string }): Promise<{ contextId: string }>;
  createSession(input: CreateSessionInput): Promise<BrowserSession>;
  getSession(sessionId: string): Promise<BrowserSession | null>;
  requestRelease(sessionId: string): Promise<{ accepted: boolean; ended: boolean }>;
  deleteContext(contextId: string): Promise<{ deleted: boolean }>;
  attachConnection(sessionId: string): Promise<{ connectUrl: string }>;
  issueControlView(sessionId: string, generation: number): Promise<ControlView>;
  revokeControlView(sessionId: string, generation: number): Promise<RevokeControlResult>;
  usage(sessionId: string): Promise<UsageReport>;
}

export function assertPolicySupported(policy: SessionPolicy) {
  if (policy.recordSession !== false) throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Session recording must stay off.");
  if (policy.logSession !== false) throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Provider logging must stay off.");
  if (policy.captchaSolving !== false) throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "CAPTCHA solving is not allowed.");
  if (policy.advancedStealth !== false) throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Stealth escalation is not allowed.");
  if (policy.validateCertificates !== true) throw new BrowserProviderError("PROVIDER_UNSUPPORTED_PRIVACY", "Certificate validation must stay on.");
}
