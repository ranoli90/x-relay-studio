import {
  TERMINAL_STATUSES,
  type CommandKind,
  type ConnectionState,
  type CreationOutcome,
  type JobStatus,
  type JobStep,
  type PermittedAction,
  type ControlOwner,
} from "./types.ts";

export type MachineJob = {
  status: JobStatus;
  step: JobStep;
  version: number;
  mode: "assisted" | "manual";
  intent: "create" | "connect_existing";
  creationOutcome: CreationOutcome;
  connectionState: ConnectionState;
  controlOwner: ControlOwner;
  cancelRequested: boolean;
  submitSideEffect?: "prepared" | "started" | "confirmed" | "rejected" | "unknown" | null;
};

export type MachineEvent =
  | { type: "OWNER_STARTS" }
  | { type: "LEASE_ACQUIRED" }
  | { type: "VERIFICATION_NEEDED"; reason: string }
  | { type: "SUBMIT_APPROVED" }
  | { type: "SUBMIT_LOST" }
  | { type: "OWNER_RETURNS_CONTROL" }
  | { type: "ACCOUNT_CONFIRMED_APP_NOT_READY" }
  | { type: "OWNER_STARTS_OAUTH" }
  | { type: "OAUTH_INTENDED_IDENTITY" }
  | { type: "HEALTH_USABLE_OWNER_CONFIRMS" }
  | { type: "OWNER_CANCELS" }
  | { type: "PERMISSION_REVOKED" }
  | { type: "DEADLINE_EXCEEDED" }
  | { type: "MANUAL_OWNER_REPORTED" }
  | { type: "UNSUPPORTED_PAGE" }
  | { type: "RECONCILED"; outcome: CreationOutcome }
  | { type: "HANDOFF_TO_MANUAL" };

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

export function isTerminal(status: JobStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function applyEvent(job: MachineJob, event: MachineEvent): MachineJob {
  if (isTerminal(job.status) && event.type !== "OWNER_CANCELS") {
    throw new TransitionError(`Job is ${job.status}; no further transitions.`);
  }

  switch (event.type) {
    case "OWNER_STARTS":
      requireStatus(job, ["draft"]);
      return next(job, {
        status: job.mode === "manual" || job.intent === "connect_existing" ? "waiting_external" : "queued",
        step: job.intent === "connect_existing" ? "app_access" : job.mode === "manual" ? "create_account" : "session",
        creationOutcome: job.intent === "connect_existing" ? "preexisting" : "in_progress",
      });
    case "LEASE_ACQUIRED":
      requireStatus(job, ["queued"]);
      return next(job, { status: "running", step: "create_account", controlOwner: "worker" });
    case "VERIFICATION_NEEDED":
      requireStatus(job, ["running"]);
      return next(job, { status: "needs_user", step: "verify_account", controlOwner: "none" });
    case "SUBMIT_APPROVED":
      requireStatus(job, ["running", "needs_user"]);
      if (job.submitSideEffect === "started" || job.submitSideEffect === "unknown") {
        throw new TransitionError("An irreversible submit is already in flight.");
      }
      return next(job, {
        status: "running",
        step: "create_account",
        submitSideEffect: "prepared",
        controlOwner: "worker",
      });
    case "SUBMIT_LOST":
      requireStatus(job, ["queued", "running", "needs_user"]);
      return next(job, {
        status: "reconciling",
        creationOutcome: "unknown",
        submitSideEffect: "unknown",
        controlOwner: "none",
      });
    case "OWNER_RETURNS_CONTROL":
      requireStatus(job, ["needs_user", "running"]);
      return next(job, { status: "reconciling", controlOwner: "none" });
    case "ACCOUNT_CONFIRMED_APP_NOT_READY":
      requireStatus(job, ["running", "needs_user", "waiting_external", "reconciling"]);
      return next(job, {
        status: "waiting_external",
        step: "app_access",
        creationOutcome: job.creationOutcome === "unknown" ? "unknown" : "confirmed",
        controlOwner: "none",
      });
    case "MANUAL_OWNER_REPORTED":
      requireStatus(job, ["draft", "waiting_external", "needs_user", "running"]);
      return next(job, {
        status: "waiting_external",
        step: "app_access",
        creationOutcome: "in_progress",
        identityLocked: false,
      });
    case "OWNER_STARTS_OAUTH":
      requireStatus(job, ["waiting_external", "needs_user", "running", "draft"]);
      return next(job, { status: "needs_user", step: "oauth" });
    case "OAUTH_INTENDED_IDENTITY":
      requireStatus(job, ["needs_user", "running", "waiting_external"]);
      return next(job, {
        status: "running",
        step: "health",
        connectionState: "pending",
        creationOutcome:
          job.intent === "connect_existing"
            ? "preexisting"
            : job.creationOutcome === "unknown"
              ? "unknown"
              : "confirmed",
      });
    case "HEALTH_USABLE_OWNER_CONFIRMS":
      requireStatus(job, ["running", "needs_user"]);
      return next(job, {
        status: "completed",
        step: "finish",
        connectionState: "verified",
      });
    case "OWNER_CANCELS":
      if (isTerminal(job.status) && job.status !== "blocked") {
        throw new TransitionError("Already finished.");
      }
      return next(job, {
        status: job.submitSideEffect === "started" || job.creationOutcome === "unknown" ? "reconciling" : "cancelled",
        cancelRequested: true,
        controlOwner: "none",
      });
    case "PERMISSION_REVOKED":
      return next(job, { status: "blocked", controlOwner: "none" });
    case "DEADLINE_EXCEEDED":
      if (job.creationOutcome === "unknown" || job.submitSideEffect === "started") {
        return next(job, { status: "reconciling" });
      }
      return next(job, { status: "expired" });
    case "UNSUPPORTED_PAGE":
      requireStatus(job, ["running", "needs_user"]);
      return next(job, { status: "needs_user", step: "create_account", controlOwner: "none" });
    case "RECONCILED":
      requireStatus(job, ["reconciling", "needs_user"]);
      if (job.cancelRequested) {
        return next(job, { status: "cancelled", creationOutcome: event.outcome });
      }
      if (event.outcome === "confirmed") {
        return next(job, { status: "waiting_external", step: "app_access", creationOutcome: "confirmed" });
      }
      if (event.outcome === "rejected") {
        return next(job, { status: "failed", creationOutcome: "rejected" });
      }
      return next(job, { status: "needs_user", creationOutcome: event.outcome });
    case "HANDOFF_TO_MANUAL":
      requireStatus(job, ["draft", "queued", "running", "needs_user", "waiting_external", "reconciling"]);
      return next(job, {
        mode: "manual",
        status: "waiting_external",
        step:
          job.intent === "connect_existing"
            ? "app_access"
            : job.step === "consent"
              ? "create_account"
              : job.step,
        controlOwner: "none",
      });
    default:
      throw new TransitionError("Unknown event.");
  }
}

function requireStatus(job: MachineJob, allowed: JobStatus[]) {
  if (!allowed.includes(job.status)) {
    throw new TransitionError(`Cannot run this action from ${job.status}.`);
  }
}

function next(
  job: MachineJob,
  patch: Partial<MachineJob> & { identityLocked?: boolean },
): MachineJob {
  const { identityLocked: _ignored, ...rest } = patch;
  return { ...job, ...rest, version: job.version + 1 };
}

export function permittedActions(job: MachineJob, caps: { assisted: boolean; oauth: boolean; appReady: boolean }): PermittedAction[] {
  const actions: PermittedAction[] = [];
  if (isTerminal(job.status)) {
    if (job.status === "completed") actions.push("open_dashboard", "manage_saved_access");
    else actions.push("finish_later");
    return actions;
  }
  actions.push("cancel");
  if (job.status === "draft") {
    actions.push("save_details");
    if (job.mode === "assisted" && caps.assisted) actions.push("start_assisted");
    actions.push("start_manual", "open_signup");
  }
  if (job.status === "waiting_external" || job.status === "needs_user") {
    if (job.step === "create_account" || job.step === "verify_account" || job.step === "consent") {
      actions.push("continue_manual", "open_signup");
    }
    if (job.step === "app_access" || job.step === "app_credentials" || job.step === "oauth") {
      if (caps.oauth && caps.appReady) actions.push("start_oauth");
    }
    if (job.controlOwner === "worker") actions.push("request_takeover");
    if (job.controlOwner === "user") actions.push("finish_takeover");
    if (job.mode === "assisted" && !isTerminal(job.status)) actions.push("handoff_manual");
    if (job.status === "needs_user" && job.step === "create_account") actions.push("confirm_submit");
    if (job.step === "confirm" || job.step === "health") actions.push("confirm_identity");
    actions.push("finish_later");
  }
  if (job.status === "queued" || job.status === "running") {
    actions.push("request_takeover", "finish_later");
    if (job.mode === "assisted") actions.push("handoff_manual");
  }
  if (job.status === "reconciling") {
    actions.push("finish_later");
  }
  return Array.from(new Set(actions));
}

export function canExecuteCommand(job: MachineJob, kind: CommandKind): boolean {
  if (kind === "cancel") return !isTerminal(job.status) || job.status === "blocked";
  if (kind === "reconcile") return job.status === "reconciling" || job.status === "running";
  if (isTerminal(job.status)) return false;
  if (job.cancelRequested) return false;
  switch (kind) {
    case "start":
      return job.status === "draft" || job.status === "queued";
    case "continue":
      return job.status === "needs_user" || job.status === "waiting_external" || job.status === "queued";
    case "request_takeover":
      return job.status === "running" || job.controlOwner === "worker";
    case "end_takeover":
      return job.controlOwner === "user";
    case "confirm_submit":
      return job.status === "needs_user" || job.status === "running";
    case "finalize":
      return job.step === "confirm" || job.step === "health" || job.step === "finish";
    case "handoff_manual":
      return job.mode === "assisted" && !isTerminal(job.status);
    default:
      return false;
  }
}

export function irreversibleSubmitBlocked(job: MachineJob): boolean {
  return job.submitSideEffect === "started" || job.submitSideEffect === "unknown";
}
