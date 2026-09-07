import type { OnboardingJobPublic } from "./types.ts";

export type ProgressCopyJob = Pick<
  OnboardingJobPublic,
  "status" | "mode" | "intent" | "step" | "waitReason" | "expectedUsername"
> & { hostedSession?: boolean };

function isManualCreate(job: ProgressCopyJob): boolean {
  if (job.intent !== "create") return false;
  if (job.mode === "manual") return true;
  return job.status === "draft" && (job.step === "consent" || job.step === "create_account");
}

function isOwnerGateCopy(text: string): boolean {
  return /captcha|security check|robot|tick the|user agreement|sign up button|complete the security/i.test(
    text,
  );
}

export function progressTitle(job: ProgressCopyJob): string {
  if (job.waitReason && !isOwnerGateCopy(job.waitReason)) return job.waitReason;
  if (job.status === "needs_user") return "Create this Reddit account.";
  if (job.status === "reconciling") return "Checking the result";
  if (job.status === "waiting_external" && isManualCreate(job)) return "Create this Reddit account.";
  if (job.status === "waiting_external") return "Waiting on the next Reddit step";
  if (job.status === "queued" || job.status === "running") return "Working through supported steps";
  if (job.status === "cancelled") return "Setup stopped";
  if (job.status === "draft") return "Create this Reddit account.";
  return "Reddit setup";
}

export function progressEventCopy(type: string): string {
  switch (type) {
    case "batch_queued":
      return "Queued. Create the account on Reddit, then continue here.";
    case "handoff_manual":
      return "This desk is not filling the form. Create the account on Reddit, then continue.";
    case "started":
      return "Opened signup.";
    case "session_allocation_confirmed":
      return "Hosted browser is ready.";
    case "user_action_required":
      return "Open Reddit signup if you have not already, then continue here.";
    case "result_unknown":
      return "Checking the result. We will not submit again.";
    case "oauth_started":
      return "Connect with Reddit to verify the account.";
    default:
      return "";
  }
}

export function progressBody(job: ProgressCopyJob, lastEventType?: string | null): string {
  if (job.hostedSession && job.intent === "create" && job.status !== "running") {
    return "A fresh browser is open below. Create the account there, then continue with the username you used. We will not guess it.";
  }
  if (isManualCreate(job) && job.status !== "running") {
    return "Open Reddit and create the account. Come back and continue with the username you used. We will not guess it.";
  }
  if (job.status === "running") {
    return "Filling supported fields in the hosted browser. Continue here when the account exists.";
  }
  if (job.status === "queued") {
    return "Waiting for the hosted browser. Keep this screen open.";
  }
  const fromEvent = lastEventType ? progressEventCopy(lastEventType) : "";
  if (fromEvent) return fromEvent;
  if (job.status === "needs_user") {
    return "Open Reddit and create the account. Come back and continue with the username you used.";
  }
  return "Waiting for the next step.";
}
