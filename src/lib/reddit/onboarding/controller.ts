import { fixtureOriginAllowlist } from "./config.ts";
import { actionAllowed, type ActionPolicyContext, type ObservedAction } from "./policy.ts";
import type { SignupObservation } from "./types.ts";

export const FIXTURE_TITLE = "Isolated onboarding fixture";
export const FIXTURE_PATH = "/__reddit-onboarding-fixture";
const HARDCODED_TEST_TITLE = "TEST signup fixture";

export type ObservedField = {
  name: string;
  type: string;
  filled: boolean;
  ownerOnly?: boolean;
};

export type PageObservation = {
  title: string;
  url: string;
  origin: string;
  testid: string | null;
  bodyText: string;
  fields: ObservedField[];
  hasCaptcha: boolean;
  hasTerms: boolean;
  hasFinalSubmit: boolean;
};

export type ClickRequest = {
  selector?: string;
  name?: string;
  fieldLabel?: string;
  allowedTarget?: string;
};

export type ClickResult = {
  blocked: boolean;
  requiredHumanAction: "captcha" | "terms" | "final_submit" | null;
};

export interface PageDriver {
  readonly paused: boolean;
  pause(): void;
  resume(): void;
  navigate(url: string): Promise<void>;
  fill(selector: string, value: string, fieldLabel?: string): Promise<void>;
  click(target: ClickRequest): Promise<ClickResult>;
  wait(ms?: number): Promise<void>;
  observe(): Promise<PageObservation>;
}

export type SignupPlanItem = {
  action: ObservedAction;
  value?: string;
};

export type BoundedPolicyContext = ActionPolicyContext & {
  step?: string;
  fillValues?: { username?: string; email?: string };
};

export function fixtureSignupUrl(): string {
  const origin = fixtureOriginAllowlist()[0] || "http://127.0.0.1:8080";
  return `${origin}${FIXTURE_PATH}/`;
}

function isSensitiveLabel(label: string): boolean {
  return /(password|otp|\bcode\b|token|cookie)/i.test(label);
}

function fillValueFor(action: ObservedAction, item: SignupPlanItem, ctx: BoundedPolicyContext): string | undefined {
  const key = (action.fieldLabel || action.name || "").toLowerCase();
  if (key === "username") return item.value ?? ctx.fillValues?.username;
  if (key === "email") return item.value ?? ctx.fillValues?.email;
  return undefined;
}

function ownerActionFrom(page: PageObservation): string | null {
  if (page.hasCaptcha) return "captcha";
  if (page.hasTerms) return "terms";
  if (page.hasFinalSubmit) return "final_submit";
  return null;
}

function observationFromPage(page: PageObservation): SignupObservation {
  const text = `${page.title} ${page.testid || ""} ${page.bodyText}`.toLowerCase();
  if (page.title === HARDCODED_TEST_TITLE) {
    return {
      supportedVariant: "unknown",
      currentStep: "create_account",
      requiredHumanAction: "manual",
      submissionOutcome: "none",
      expectedUsernameVisible: false,
      identityHint: null,
      errorCode: "UNSUPPORTED_PAGE_VARIANT",
    };
  }
  if (text.includes("unsupported") || text.includes("unknown-variant") || !page.title) {
    return {
      supportedVariant: "unknown",
      currentStep: "create_account",
      requiredHumanAction: "manual",
      submissionOutcome: "none",
      expectedUsernameVisible: false,
      identityHint: null,
      errorCode: "UNSUPPORTED_PAGE_VARIANT",
    };
  }
  const username = page.fields.find((f) => f.name === "username");
  return {
    supportedVariant: "email",
    currentStep: "create_account",
    requiredHumanAction: ownerActionFrom(page),
    submissionOutcome: "none",
    expectedUsernameVisible: Boolean(username),
    identityHint: username?.filled ? "username" : null,
    errorCode: null,
  };
}

async function waitWhilePaused(driver: PageDriver): Promise<void> {
  while (driver.paused) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function runBoundedSignup(
  driver: PageDriver,
  plan: ReadonlyArray<SignupPlanItem>,
  policyCtx: BoundedPolicyContext = {},
): Promise<SignupObservation> {
  const step = policyCtx.step ?? "create_account";
  for (const item of plan) {
    await waitWhilePaused(driver);
    const snapshot = await driver.observe();
    const pageOrigin = snapshot.origin || policyCtx.pageOrigin;
    const ctx: ActionPolicyContext = {
      fixtureMode: policyCtx.fixtureMode,
      pageOrigin,
      frameOrigin: policyCtx.frameOrigin ?? (snapshot.origin || pageOrigin),
    };
    const allowed = actionAllowed(item.action, step, ctx);
    if (!allowed.ok) {
      return {
        supportedVariant: "unknown",
        currentStep: "create_account",
        requiredHumanAction: "manual",
        submissionOutcome: "none",
        expectedUsernameVisible: false,
        identityHint: null,
        errorCode: allowed.code,
      };
    }

    const method = item.action.method.toLowerCase();
    if (method === "navigate") {
      if (!item.action.url) {
        return observationDenied("NAVIGATION_DENIED");
      }
      await driver.navigate(item.action.url);
    } else if (method === "fill") {
      const label = `${item.action.fieldLabel || ""} ${item.action.name || ""} ${item.action.selector || ""}`;
      if (isSensitiveLabel(label)) {
        return observationDenied("SENSITIVE_FIELD");
      }
      const value = fillValueFor(item.action, item, policyCtx);
      if (!value || !item.action.selector) {
        return observationDenied("FILL_VALUE_MISSING");
      }
      await driver.fill(item.action.selector, value, item.action.fieldLabel);
    } else if (method === "click") {
      const result = await driver.click({
        selector: item.action.selector,
        name: item.action.name,
        fieldLabel: item.action.fieldLabel,
        allowedTarget: item.action.allowedTarget,
      });
      if (result.blocked) {
        const page = await driver.observe();
        const obs = observationFromPage(page);
        obs.requiredHumanAction = result.requiredHumanAction || obs.requiredHumanAction;
        return obs;
      }
    } else if (method === "wait") {
      await driver.wait();
    } else if (method === "observe" || method === "read_identity") {
      await driver.observe();
    }
  }

  await waitWhilePaused(driver);
  const page = await driver.observe();
  return observationFromPage(page);
}

function observationDenied(code: string): SignupObservation {
  return {
    supportedVariant: "unknown",
    currentStep: "create_account",
    requiredHumanAction: "manual",
    submissionOutcome: "none",
    expectedUsernameVisible: false,
    identityHint: null,
    errorCode: code,
  };
}

type FixtureState = {
  loaded: boolean;
  url: string;
  origin: string;
  title: string;
  username: string;
  email: string;
  passwordFilled: boolean;
};

export class FakePageDriver implements PageDriver {
  paused = false;
  navigations = 0;
  fills = 0;
  private state: FixtureState = blankState();

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async navigate(url: string): Promise<void> {
    this.navigations += 1;
    const parsed = new URL(url);
    this.state.url = parsed.href;
    this.state.origin = parsed.origin;
    if (parsed.pathname.startsWith(FIXTURE_PATH)) {
      this.state.loaded = true;
      this.state.title = FIXTURE_TITLE;
      return;
    }
    this.state.loaded = false;
    this.state.title = "unsupported off-fixture page";
    this.state.username = "";
    this.state.email = "";
    this.state.passwordFilled = false;
  }

  async fill(selector: string, value: string, fieldLabel?: string): Promise<void> {
    const blob = `${fieldLabel || ""} ${selector}`;
    if (isSensitiveLabel(blob) || /\[type=['"]password['"]\]/i.test(selector)) {
      throw new Error("SENSITIVE_FIELD");
    }
    if (!this.state.loaded) throw new Error("PAGE_NOT_LOADED");
    this.fills += 1;
    if (/username/i.test(blob)) {
      this.state.username = value;
      return;
    }
    if (/email/i.test(blob)) {
      this.state.email = value;
      return;
    }
    throw new Error("UNKNOWN_FIELD");
  }

  async click(target: ClickRequest): Promise<ClickResult> {
    const blob = `${target.allowedTarget || ""} ${target.fieldLabel || ""} ${target.name || ""} ${target.selector || ""}`.toLowerCase();
    if (/(captcha)/.test(blob)) return { blocked: true, requiredHumanAction: "captcha" };
    if (/(terms|accept-terms)/.test(blob)) return { blocked: true, requiredHumanAction: "terms" };
    if (/(submit-final|final-submit|final_submit)/.test(blob)) {
      return { blocked: true, requiredHumanAction: "final_submit" };
    }
    return { blocked: false, requiredHumanAction: null };
  }

  async wait(): Promise<void> {
    return;
  }

  async observe(): Promise<PageObservation> {
    if (!this.state.loaded) {
      return {
        title: this.state.title,
        url: this.state.url,
        origin: this.state.origin,
        testid: null,
        bodyText: "",
        fields: [],
        hasCaptcha: false,
        hasTerms: false,
        hasFinalSubmit: false,
      };
    }
    return {
      title: this.state.title,
      url: this.state.url,
      origin: this.state.origin,
      testid: "fixture-email-v1",
      bodyText: "TEST environment. This page is not Reddit and creates no real accounts. Create a test account",
      fields: [
        { name: "username", type: "text", filled: Boolean(this.state.username) },
        { name: "email", type: "email", filled: Boolean(this.state.email) },
        { name: "password", type: "password", filled: this.state.passwordFilled, ownerOnly: true },
      ],
      hasCaptcha: true,
      hasTerms: true,
      hasFinalSubmit: true,
    };
  }
}

function blankState(): FixtureState {
  return {
    loaded: false,
    url: "",
    origin: "",
    title: "",
    username: "",
    email: "",
    passwordFilled: false,
  };
}
