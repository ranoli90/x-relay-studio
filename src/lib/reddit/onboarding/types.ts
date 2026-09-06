export const JOB_STATUSES = [
  "draft",
  "queued",
  "running",
  "needs_user",
  "waiting_external",
  "reconciling",
  "completed",
  "cancelled",
  "failed",
  "blocked",
  "expired",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "completed",
  "cancelled",
  "failed",
  "blocked",
  "expired",
];

export const JOB_STEPS = [
  "consent",
  "session",
  "create_account",
  "verify_account",
  "app_access",
  "app_credentials",
  "oauth",
  "health",
  "confirm",
  "finish",
] as const;
export type JobStep = (typeof JOB_STEPS)[number];

export const JOB_MODES = ["assisted", "manual"] as const;
export type JobMode = (typeof JOB_MODES)[number];

export const JOB_INTENTS = ["create", "connect_existing"] as const;
export type JobIntent = (typeof JOB_INTENTS)[number];

export const CREATION_OUTCOMES = [
  "not_started",
  "in_progress",
  "confirmed",
  "rejected",
  "unknown",
  "preexisting",
] as const;
export type CreationOutcome = (typeof CREATION_OUTCOMES)[number];

export const CONNECTION_STATES = [
  "not_started",
  "pending",
  "verified",
  "requires_reauth",
  "disabled",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const CONTROL_OWNERS = ["worker", "user", "none"] as const;
export type ControlOwner = (typeof CONTROL_OWNERS)[number];

export const COMMAND_KINDS = [
  "start",
  "continue",
  "request_takeover",
  "end_takeover",
  "confirm_submit",
  "reconcile",
  "cancel",
  "finalize",
  "handoff_manual",
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export const SIDE_EFFECT_STATUSES = [
  "prepared",
  "started",
  "confirmed",
  "rejected",
  "unknown",
] as const;
export type SideEffectStatus = (typeof SIDE_EFFECT_STATUSES)[number];

export const PROFILE_STATUSES = [
  "requested",
  "temporary",
  "retained",
  "needs_reauth",
  "expired",
  "delete_pending",
  "deleted",
  "failed",
  "quarantined",
  "deleting",
  "error",
] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const SECRET_PURPOSES = [
  "signup_email",
  "temporary_signup_password",
  "retained_reddit_password",
  "oauth_revocation_material",
  "browser_host_key",
] as const;
export type SecretPurpose = (typeof SECRET_PURPOSES)[number];

export const CLEANUP_KINDS = [
  "release_session",
  "revoke_oauth",
  "delete_context",
  "purge_temporary_secret",
  "purge_retained_secret",
  "confirm_local_disconnect",
] as const;
export type CleanupKind = (typeof CLEANUP_KINDS)[number];

export const IDENTITY_EVIDENCE = [
  "provider_observed",
  "owner_reported",
  "oauth_verified_identity",
  "preexisting",
] as const;
export type IdentityEvidenceKind = (typeof IDENTITY_EVIDENCE)[number];

export const ASSISTANCE_CONSENT_VERSION = "reddit-onboarding-assistance-v1";
export const USE_CASE_VERSION = "data-api-v1";
export const WORKFLOW_ID = "email-signup";
export const ACCOUNT_CAP = 8;
export const MAX_MODEL_CALLS = 8;
export const DEFAULT_SESSION_SECONDS = 900;
export const DEFAULT_GLOBAL_CONCURRENCY = 3;
export const DEFAULT_CONTEXT_RETENTION_DAYS = 30;
export const REVIEWED_SIGNUP_URL = "https://www.reddit.com/register/";

export type CapabilityKey =
  | "canStartAssistedSignup"
  | "canContinueManualSetup"
  | "canConfigureApprovedApp"
  | "canStartOAuth"
  | "canReadIdentity"
  | "canReadClassicInbox"
  | "canReuseBrowserForApprovedAction"
  | "canPost"
  | "canVote"
  | "canSendMessages";

export type CapabilityMap = Record<CapabilityKey, boolean> & {
  reasons: Partial<Record<CapabilityKey, string>>;
};

export type PermittedAction =
  | "save_details"
  | "start_assisted"
  | "start_manual"
  | "continue_manual"
  | "open_signup"
  | "request_takeover"
  | "finish_takeover"
  | "confirm_submit"
  | "start_oauth"
  | "confirm_identity"
  | "cancel"
  | "finish_later"
  | "open_dashboard"
  | "manage_saved_access"
  | "handoff_manual"
  | "open_readiness"
  | "open_drafts"
  | "manage_email";

export type OnboardingJobPublic = {
  id: string;
  mode: JobMode;
  intent: JobIntent;
  status: JobStatus;
  step: JobStep;
  version: number;
  expectedUsername: string | null;
  verifiedUsername: string | null;
  accountId: string | null;
  controlOwner: ControlOwner;
  creationOutcome: CreationOutcome;
  connectionState: ConnectionState;
  waitReason: string | null;
  waitDeadlineAt: string | null;
  lastActivityAt: string;
  finishedAt: string | null;
  cleanupSummary: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  maskedEmail: string | null;
  retainContext: boolean;
  retainPassword: boolean;
  retentionStatus: string | null;
  retentionExpiresAt: string | null;
  cleanupPending: boolean;
  permittedActions: PermittedAction[];
  capabilities: CapabilityMap;
};

export type OnboardingEventPublic = {
  sequence: number;
  eventType: string;
  actorKind: string;
  occurredAt: string;
  jobVersion: number;
  details: Record<string, string | number | boolean | null>;
};

export type ResumeCandidate = {
  kind: "job" | "unconfirmed_account";
  id: string;
  label: string;
  status: string;
};

export const BROWSER_PROVIDERS = ["fake", "browserbase", "steel", "local"] as const;
export type BrowserProviderName = (typeof BROWSER_PROVIDERS)[number];

export type OnboardingBootstrap = {
  onboardingEnabled: boolean;
  assistedAvailable: boolean;
  assistedUnavailableReason: string | null;
  currentJob: OnboardingJobPublic | null;
  resumeCandidates: ResumeCandidate[];
  capabilities: CapabilityMap;
  sessionMaxSeconds: number;
  reviewedSignupUrl: string;
  appConfigured: boolean;
  fixtureEnabled: boolean;
  provider: BrowserProviderName;
  steelHost: SteelHostPublic;
};

export type SteelHostPublic = {
  connected: boolean;
  source: "env" | "saved" | "none";
  hint: string | null;
  lastVerifiedAt: string | null;
  signupUrl: string;
  keysUrl: string;
  previewUsesLocal: boolean;
};

export type SignupObservation = {
  supportedVariant: "email" | "google" | "apple" | "phone" | "unknown";
  currentStep: JobStep;
  requiredHumanAction: string | null;
  submissionOutcome: "none" | "pending" | "confirmed" | "rejected" | "unknown";
  expectedUsernameVisible: boolean;
  identityHint: string | null;
  errorCode: string | null;
};

export type BrowserProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNSUPPORTED_PRIVACY"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_NOT_CONFIGURED"
  | "SESSION_AMBIGUOUS"
  | "CONTEXT_DENIED"
  | "CONTROL_NOT_READY"
  | "FAKE_PROVIDER"
  | "PROVIDER_UNKNOWN_STATUS";

export class OnboardingError extends Error {
  code: string;
  httpStatus: number;
  currentVersion?: number;
  constructor(code: string, message: string, httpStatus = 400, currentVersion?: number) {
    super(message);
    this.name = "OnboardingError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.currentVersion = currentVersion;
  }
}

export const EMAIL_BINDING_KINDS = ["existing_inbox", "owned_domain_alias", "managed_inbox"] as const;
export type EmailBindingKind = (typeof EMAIL_BINDING_KINDS)[number];

export const EMAIL_BINDING_STATUSES = [
  "requested",
  "pending",
  "verified",
  "destination_failed",
  "quota_blocked",
  "delete_pending",
  "deleted",
  "failed",
] as const;
export type EmailBindingStatus = (typeof EMAIL_BINDING_STATUSES)[number];

export const READINESS_VALUES = ["pass", "blocked", "verified", "unverified", "valid", "needs_reauth", "action_needed", "none_reported", "restricted", "eligible", "needs_review", "running", "ended", "unknown"] as const;
export type ReadinessValue = (typeof READINESS_VALUES)[number];

export type ReadinessCheck = {
  key: "owner" | "identity" | "access" | "recovery" | "restriction" | "permissions" | "community" | "session";
  label: string;
  status: string;
  reason: string | null;
  lastObservedAt: string | null;
};

export type ReadinessReport = {
  accountId: string;
  checks: ReadinessCheck[];
  inventedReputation: false;
  cqsClaim: null;
};

export type DraftPublic = {
  id: string;
  version: number;
  accountId: string;
  community: string;
  topic: string;
  title: string;
  body: string;
  postType: string;
  flair: string | null;
  fitExplanation: string | null;
  validationStatus: string;
  approvalStatus: string;
  contentHash: string;
  createdAt: string;
};

export type EmailBindingPublic = {
  id: string;
  kind: EmailBindingKind;
  provider: string;
  maskedDisplay: string;
  status: EmailBindingStatus;
  destinationVerified: boolean;
  accountId: string | null;
};

