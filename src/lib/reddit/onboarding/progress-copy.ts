import type { OnboardingJobPublic } from "./types.ts";

export type ProgressCopyJob = Pick<
  OnboardingJobPublic,
  "status" | "mode" | "intent" | "step" | "waitReason" | "expectedUsername"
>;

function isManualCreate(job: ProgressCopyJob): boolean {
  if (job.intent !== "create") return false;
  if (job.mode === "manual") return true;
  return job.status === "draft" && (job.step === "consent" || job.step === "create_account");
}

export function progressTitle(job: ProgressCopyJob): string {
  if (job.waitReason) return job.waitReason;
  if (job.status === "needs_user") return "Your turn";
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
      return "Waiting for your verification.";
    case "result_unknown":
      return "Checking the result. We will not submit again.";
    case "oauth_started":
      return "Connect with Reddit to verify the account.";
    default:
      return "";
  }
}

export function progressBody(job: ProgressCopyJob, lastEventType?: string | null): string {
  if (isManualCreate(job) && job.status !== "running") {
    return "Open Reddit and create the account. Come back and continue with the username you used. We will not guess it.";
  }
  if (job.status === "running") {
    return "Automation is filling supported fields. CAPTCHA, terms, and Sign Up stay yours.";
  }
  if (job.status === "queued") {
    return "Waiting for the hosted browser. Keep this screen open.";
  }
  const fromEvent = lastEventType ? progressEventCopy(lastEventType) : "";
  if (fromEvent) return fromEvent;
  if (job.status === "needs_user") return "Your turn on the Reddit page.";
  return "Waiting for the next step.";
}
