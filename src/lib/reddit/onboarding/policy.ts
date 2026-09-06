import { redditConnectorEnabled } from "../../flags.ts";
import {
  browserbaseConfigured,
  environmentId,
  fixtureOriginAllowlist,
  onboardingFixtureEnabled,
  productionForbidsFakeProvider,
  redditAssistedSignupEnabled,
  redditBrowserProvider,
  redditOnboardingEnabled,
  redditRemoteOauthEnabled,
} from "./config.ts";
import type { CapabilityMap, CapabilityKey } from "./types.ts";

const ALWAYS_FALSE: CapabilityKey[] = ["canPost", "canVote", "canSendMessages"];

export type PolicyInput = {
  onboardingEnabled?: boolean;
  assistedFlag?: boolean;
  connectorEnabled?: boolean;
  approvalStatus?: string;
  provider?: "fake" | "browserbase";
  providerConfigured?: boolean;
  assistanceConsent?: boolean;
  accountOwned?: boolean;
  budgetAvailable?: boolean;
  killAssisted?: boolean;
  appConfigured?: boolean;
};

export function capabilities(input: PolicyInput = {}): CapabilityMap {
  const reasons: CapabilityMap["reasons"] = {};
  const onboarding = input.onboardingEnabled ?? redditOnboardingEnabled();
  const assistedFlag = input.assistedFlag ?? redditAssistedSignupEnabled();
  const connector = input.connectorEnabled ?? redditConnectorEnabled();
  const provider = input.provider ?? redditBrowserProvider();
  const configured = input.providerConfigured ?? (provider === "fake" || browserbaseConfigured());
  const approval = input.approvalStatus ?? "needs_review";
  const budget = input.budgetAvailable ?? true;
  const kill = input.killAssisted ?? false;

  const deny = (key: CapabilityKey, code: string) => {
    reasons[key] = code;
    return false;
  };

  const canContinueManualSetup = onboarding
    ? true
    : deny("canContinueManualSetup", "ONBOARDING_DISABLED");

  const canConfigureApprovedApp = connector
    ? true
    : deny("canConfigureApprovedApp", "REDDIT_CONNECTOR_DISABLED");

  let canStartAssistedSignup = true;
  if (!onboarding) canStartAssistedSignup = deny("canStartAssistedSignup", "ONBOARDING_DISABLED");
  else if (!assistedFlag) canStartAssistedSignup = deny("canStartAssistedSignup", "ASSISTED_DISABLED");
  else if (kill) canStartAssistedSignup = deny("canStartAssistedSignup", "KILL_SWITCH");
  else if (approval !== "approved") canStartAssistedSignup = deny("canStartAssistedSignup", "APPROVAL_PENDING");
  else if (!configured) canStartAssistedSignup = deny("canStartAssistedSignup", "PROVIDER_NOT_CONFIGURED");
  else if (productionForbidsFakeProvider() || (provider === "fake" && environmentId() === "production" && assistedFlag)) {
    canStartAssistedSignup = deny("canStartAssistedSignup", "FAKE_PROVIDER_FORBIDDEN");
  } else if (provider === "browserbase" && !browserbaseConfigured() && input.providerConfigured !== true) {
    canStartAssistedSignup = deny("canStartAssistedSignup", "BROWSERBASE_NOT_CONFIGURED");
  } else if (!budget) canStartAssistedSignup = deny("canStartAssistedSignup", "BUDGET_EXHAUSTED");
  else if (input.assistanceConsent === false) {
    canStartAssistedSignup = deny("canStartAssistedSignup", "CONSENT_REQUIRED");
  }

  const appReady = input.appConfigured ?? false;
  const canStartOAuth = connector && appReady
    ? true
    : deny("canStartOAuth", appReady ? "REDDIT_CONNECTOR_DISABLED" : "APP_NOT_CONFIGURED");

  const owned = input.accountOwned !== false;
  const canReadIdentity = owned ? true : deny("canReadIdentity", "NOT_OWNED");
  const canReadClassicInbox = owned ? true : deny("canReadClassicInbox", "NOT_OWNED");
  const canReuseBrowserForApprovedAction =
    canStartAssistedSignup && input.assistanceConsent === true
      ? true
      : deny("canReuseBrowserForApprovedAction", "RETENTION_NOT_GRANTED");

  return {
    canStartAssistedSignup,
    canContinueManualSetup,
    canConfigureApprovedApp,
    canStartOAuth,
    canReadIdentity,
    canReadClassicInbox,
    canReuseBrowserForApprovedAction,
    canPost: false,
    canVote: false,
    canSendMessages: false,
    reasons: {
      ...reasons,
      canPost: "PRODUCT_BOUNDARY",
      canVote: "PRODUCT_BOUNDARY",
      canSendMessages: "PRODUCT_BOUNDARY",
    },
  };
}

export function assistedUnavailableReason(caps: CapabilityMap): string | null {
  if (caps.canStartAssistedSignup) return null;
  const code = caps.reasons.canStartAssistedSignup;
  switch (code) {
    case "ASSISTED_DISABLED":
      return "Guided setup is not turned on for this environment.";
    case "APPROVAL_PENDING":
      return "Permission review is pending. Manual setup still works.";
    case "PROVIDER_NOT_CONFIGURED":
    case "BROWSERBASE_NOT_CONFIGURED":
      return "The hosted browser is not configured.";
    case "BUDGET_EXHAUSTED":
      return "The browser allowance for this desk is used up.";
    case "KILL_SWITCH":
      return "Guided setup is paused by the operator.";
    case "FAKE_PROVIDER_FORBIDDEN":
      return "This environment cannot pretend a live signup succeeded.";
    default:
      return "Guided setup is unavailable. Use manual or connect an existing account.";
  }
}

const REDDIT_ORIGINS = new Set([
  "https://www.reddit.com",
  "https://reddit.com",
  "https://old.reddit.com",
]);

const ALLOWED_PATH_PREFIXES = ["/", "/register", "/account", "/login", "/verification"];
const FIXTURE_PATH_PREFIX = "/__reddit-onboarding-fixture";

const ALLOWED_CLICK_TARGETS = new Set(["username", "email", "continue", "next"]);
const FORBIDDEN_CLICK_TARGETS = new Set([
  "terms",
  "oauth",
  "captcha",
  "submit-final",
  "submit",
  "accept_terms",
  "grant_oauth",
  "solve_captcha",
  "password",
]);

export type ActionPolicyContext = {
  frameOrigin?: string;
  pageOrigin?: string;
  fixtureMode?: boolean;
};

export function navigationAllowed(url: string, opts?: { fixtureMode?: boolean }): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isLoopback = host === "localhost" || host === "127.0.0.1";
    if (parsed.protocol !== "https:" && !isLoopback) return false;
    if (isLoopback) {
      if (!onboardingFixtureEnabled()) return false;
      if (opts?.fixtureMode === false) return false;
      if (!parsed.pathname.startsWith(FIXTURE_PATH_PREFIX)) return false;
      return fixtureOriginAllowlist().includes(parsed.origin);
    }
    if (!REDDIT_ORIGINS.has(parsed.origin)) return false;
    return ALLOWED_PATH_PREFIXES.some((p) => parsed.pathname === p || parsed.pathname.startsWith(`${p}/`));
  } catch {
    return false;
  }
}

export const FORBIDDEN_ACTIONS = new Set([
  "evaluate",
  "cdp",
  "prompt",
  "click_delete",
  "accept_terms",
  "grant_oauth",
  "solve_captcha",
  "post",
  "vote",
  "send_message",
  "rotate_proxy",
  "create_mailbox",
]);

export type ObservedAction = {
  method: string;
  selector?: string;
  url?: string;
  fieldLabel?: string;
  name?: string;
  allowedTarget?: string;
  origin?: string;
};

function clickTarget(action: ObservedAction): string {
  return (action.allowedTarget || action.fieldLabel || action.name || "").toLowerCase().trim();
}

function sensitiveFill(action: ObservedAction): boolean {
  const blob = `${action.fieldLabel || ""} ${action.name || ""} ${action.selector || ""} ${action.allowedTarget || ""}`.toLowerCase();
  return /(password|otp|\bcode\b|token|cookie)/.test(blob);
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return new URL(value).origin;
    return new URL(value.endsWith("/") ? value : `${value}/`).origin;
  } catch {
    return null;
  }
}

export function actionAllowed(
  action: ObservedAction,
  step: string,
  ctx: ActionPolicyContext = {},
): { ok: true } | { ok: false; code: string } {
  const method = action.method.toLowerCase();
  if (FORBIDDEN_ACTIONS.has(method)) return { ok: false, code: "ACTION_FORBIDDEN" };
  const allowedMethods = new Set(["navigate", "fill", "click", "wait", "observe", "read_identity"]);
  if (!allowedMethods.has(method)) return { ok: false, code: "ACTION_FORBIDDEN" };

  if (ctx.frameOrigin && ctx.pageOrigin && ctx.frameOrigin !== ctx.pageOrigin) {
    return { ok: false, code: "FRAME_ORIGIN_DENIED" };
  }

  if (method === "navigate" && action.url && !navigationAllowed(action.url, { fixtureMode: ctx.fixtureMode })) {
    return { ok: false, code: "NAVIGATION_DENIED" };
  }

  if (method === "fill" && sensitiveFill(action)) {
    return { ok: false, code: "SENSITIVE_FIELD" };
  }

  if (method === "click") {
    const target = clickTarget(action);
    const selector = (action.selector || "").toLowerCase();
    if (!target || FORBIDDEN_CLICK_TARGETS.has(target) || !ALLOWED_CLICK_TARGETS.has(target)) {
      return { ok: false, code: "CLICK_TARGET_DENIED" };
    }
    if (/(captcha|terms|oauth|submit-final|password|otp)/.test(selector)) {
      return { ok: false, code: "CLICK_TARGET_DENIED" };
    }
  }

  const pageOrigin = ctx.pageOrigin || originOf(action.origin);
  if (ctx.frameOrigin && pageOrigin && ctx.frameOrigin !== pageOrigin) {
    return { ok: false, code: "FRAME_ORIGIN_DENIED" };
  }
  if (action.origin && action.url) {
    try {
      if (new URL(action.url).origin !== action.origin && method !== "navigate") {
        return { ok: false, code: "ORIGIN_MISMATCH" };
      }
    } catch {
      return { ok: false, code: "NAVIGATION_DENIED" };
    }
  }
  if (pageOrigin && action.url && method !== "navigate") {
    try {
      if (new URL(action.url).origin !== pageOrigin) {
        return { ok: false, code: "ORIGIN_MISMATCH" };
      }
    } catch {
      return { ok: false, code: "NAVIGATION_DENIED" };
    }
  }
  void step;
  return { ok: true };
}

export function remoteOauthAllowed(): boolean {
  return redditRemoteOauthEnabled();
}

export { ALWAYS_FALSE };
