import { Button } from "@/components/ui/button";
import type { OnboardingEventPublic, OnboardingJobPublic } from "@/lib/reddit/onboarding/types";

const STAGES = [
  { id: "account", label: "Account" },
  { id: "app", label: "App access" },
  { id: "connect", label: "Connect" },
] as const;

function stageOf(job: OnboardingJobPublic): (typeof STAGES)[number]["id"] {
  if (["oauth", "health", "confirm", "finish"].includes(job.step)) return "connect";
  if (["app_access", "app_credentials"].includes(job.step)) return "app";
  return "account";
}

export function OnboardingProgress({
  job,
  events,
  onTakeControl,
  onCancel,
  onManual,
  onOpenSignup,
  onContinue,
  busy,
}: {
  job: OnboardingJobPublic;
  events: OnboardingEventPublic[];
  onTakeControl: () => void;
  onCancel: () => void;
  onManual: () => void;
  onOpenSignup: () => void;
  onContinue: () => void;
  busy: boolean;
}) {
  const stage = stageOf(job);
  const last = events.at(-1);
  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <ol className="flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-widest text-muted">
        {STAGES.map((s) => (
          <li key={s.id} className={s.id === stage ? "text-fg" : undefined}>
            {s.label}
            {s.id !== "connect" ? " →" : ""}
          </li>
        ))}
      </ol>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        {job.waitReason || statusTitle(job)}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted" aria-live="polite">
        {last ? eventCopy(last.eventType) : "Waiting for the next step."} Automation is{" "}
        {job.status === "running" ? "in control" : "paused"}.
      </p>
      <p className="mt-2 font-mono text-xs text-subtle">
        Status {job.status} · {job.creationOutcome} creation · {job.connectionState} connection
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {job.permittedActions.includes("open_signup") ? (
          <Button type="button" onClick={onOpenSignup} disabled={busy}>
            Open Reddit signup
          </Button>
        ) : null}
        {job.permittedActions.includes("continue_manual") ? (
          <Button type="button" variant="secondary" onClick={onContinue} disabled={busy}>
            I created it — continue to connect
          </Button>
        ) : null}
        {job.permittedActions.includes("request_takeover") ? (
          <Button type="button" variant="secondary" onClick={onTakeControl} disabled={busy}>
            Take control
          </Button>
        ) : null}
        {job.permittedActions.includes("handoff_manual") ? (
          <Button type="button" variant="ghost" onClick={onManual} disabled={busy}>
            Use manual instead
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel setup
        </Button>
      </div>
      {job.errorSummary ? <p className="mt-4 text-sm text-bad">{job.errorSummary}</p> : null}
      {job.cleanupSummary ? <p className="mt-2 text-sm text-muted">{job.cleanupSummary}</p> : null}
    </section>
  );
}

function statusTitle(job: OnboardingJobPublic) {
  if (job.status === "needs_user") return "Your turn";
  if (job.status === "reconciling") return "Checking the result";
  if (job.status === "waiting_external") return "Waiting on the next Reddit step";
  if (job.status === "queued" || job.status === "running") return "Working through supported steps";
  if (job.status === "cancelled") return "Setup stopped";
  return "Reddit setup";
}

function eventCopy(type: string) {
  switch (type) {
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
      return "Setup is still in progress.";
  }
}
