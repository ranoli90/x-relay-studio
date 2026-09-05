import { actionAllowed, type ObservedAction } from "../policy.ts";
import type { SignupObservation } from "../types.ts";
import { EMAIL_SIGNUP_MANIFEST } from "./manifest.ts";

export type WorkflowStep =
  | { id: "open_signup"; action: ObservedAction }
  | { id: "fill_username"; action: ObservedAction }
  | { id: "fill_email"; action: ObservedAction }
  | { id: "wait_result"; action: ObservedAction };

export function plannedSteps(input: {
  signupUrl: string;
  expectedUsername: string;
}): WorkflowStep[] {
  return [
    {
      id: "open_signup",
      action: { method: "navigate", url: input.signupUrl },
    },
    {
      id: "fill_username",
      action: {
        method: "fill",
        selector: "[data-testid='reg-username'], input[name='username']",
        fieldLabel: "username",
      },
    },
    {
      id: "fill_email",
      action: {
        method: "fill",
        selector: "[data-testid='reg-email'], input[name='email']",
        fieldLabel: "email",
      },
    },
    {
      id: "wait_result",
      action: { method: "wait" },
    },
  ];
}

export function validatePlannedAction(action: ObservedAction, step: string) {
  return actionAllowed(action, step);
}

export function classifyPage(input: {
  title?: string;
  testid?: string;
  bodyText?: string;
}): SignupObservation {
  const text = `${input.title || ""} ${input.testid || ""} ${input.bodyText || ""}`.toLowerCase();
  if (text.includes("unsupported") || text.includes("unknown-variant")) {
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
  if (text.includes("verify") || text.includes("checkpoint")) {
    return {
      supportedVariant: "email",
      currentStep: "verify_account",
      requiredHumanAction: "verification",
      submissionOutcome: "pending",
      expectedUsernameVisible: true,
      identityHint: null,
      errorCode: null,
    };
  }
  if (text.includes("taken") || text.includes("username") && text.includes("reject")) {
    return {
      supportedVariant: "email",
      currentStep: "create_account",
      requiredHumanAction: "choose_username",
      submissionOutcome: "none",
      expectedUsernameVisible: false,
      identityHint: null,
      errorCode: "USERNAME_REJECTED",
    };
  }
  if (text.includes("google") || text.includes("apple")) {
    return {
      supportedVariant: text.includes("google") ? "google" : "apple",
      currentStep: "create_account",
      requiredHumanAction: "manual",
      submissionOutcome: "none",
      expectedUsernameVisible: false,
      identityHint: null,
      errorCode: "UNSUPPORTED_PAGE_VARIANT",
    };
  }
  return {
    supportedVariant: "email",
    currentStep: "create_account",
    requiredHumanAction: null,
    submissionOutcome: "none",
    expectedUsernameVisible: true,
    identityHint: null,
    errorCode: null,
  };
}

export function shouldCallModel(pageIsSensitive: boolean, remaining: number): boolean {
  if (pageIsSensitive) return false;
  if (remaining <= 0) return false;
  return true;
}

export { EMAIL_SIGNUP_MANIFEST };
