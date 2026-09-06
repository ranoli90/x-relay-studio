export const EMAIL_SIGNUP_MANIFEST = {
  id: "email-signup",
  version: "email-signup.v1",
  sourceCommit: "beeab5c7ca76ccac3cfa25eabf371f573561519d",
  signupMethod: "email",
  supportedPageVariants: ["fixture-email-v1"],
  testedLocales: ["en-US"],
  allowedOrigins: ["https://www.reddit.com", "http://127.0.0.1", "http://localhost"],
  privacy: {
    recordSession: false,
    logSession: false,
    captchaSolving: false,
    advancedStealth: false,
    validateCertificates: true,
  },
  maxSteps: 12,
  maxModelObservations: 8,
  model: process.env.STAGEHAND_MODEL || "unconfigured",
  allowedActions: ["navigate", "fill", "click", "wait", "observe", "read_identity"],
  forbiddenActions: [
    "evaluate",
    "accept_terms",
    "grant_oauth",
    "solve_captcha",
    "post",
    "vote",
    "send_message",
    "rotate_proxy",
    "create_mailbox",
  ],
  fixtureResults: {
    usernameRejected: "needs_user",
    verificationCheckpoint: "needs_user",
    unknownPage: "unsupported",
    success: "owner_confirm_required",
  },
} as const;

export type WorkflowManifest = typeof EMAIL_SIGNUP_MANIFEST;

export function pinWorkflowVersion(): string {
  return EMAIL_SIGNUP_MANIFEST.version;
}
