import { Button } from "@/components/ui/button";
import { CopyRow } from "@/components/reddit/copy-row";
import type { OnboardingBatchPublic, OnboardingEventPublic, OnboardingJobPublic } from "@/lib/reddit/onboarding/types";
import { progressBody, progressTitle } from "@/lib/reddit/onboarding/progress-copy";

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
  batch,
  events,
  onCancel,
  onManual,
  onOpenSignup,
  onContinue,
  onStartOauth,
  onConfirmSubmit,
  busy,
  fixture,
}: {
  job: OnboardingJobPublic;
  batch?: OnboardingBatchPublic | null;
  events: OnboardingEventPublic[];
  onTakeControl: () => void;
  onCancel: () => void;
  onManual: () => void;
  onOpenSignup: () => void;
  onContinue: () => void;
  onStartOauth?: () => void;
  onConfirmSubmit?: () => void;
  busy: boolean;
  fixture?: boolean;
}) {
  const stage = stageOf(job);
  const last = events.at(-1);
  const showContinue =
    job.permittedActions.includes("continue_manual") ||
    (job.intent === "create" && job.connectionState === "not_started" && job.status !== "running");
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
      {batch && batch.size > 1 ? (
        <p className="mt-4 font-mono text-xs tracking-[0.18em] text-reddit uppercase">
          Account {batch.currentIndex} of {batch.size}
        </p>
      ) : null}
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">{progressTitle(job)}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted" aria-live="polite">
        {progressBody(job, last?.eventType)}
      </p>
      {job.expectedUsername && job.intent === "create" && job.connectionState === "not_started" ? (
        <div className="mt-5">
          <CopyRow
            label="Suggested username"
            value={job.expectedUsername}
            hint="Use this on Reddit, or pick another and tell us after."
          />
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-3">
        {job.permittedActions.includes("open_signup") ? (
          <Button type="button" onClick={onOpenSignup} disabled={busy}>
            {fixture ? "Open the isolated test page" : "Open Reddit signup"}
          </Button>
        ) : null}
        {showContinue ? (
          <Button type="button" variant="secondary" onClick={onContinue} disabled={busy}>
            I created it — continue to connect
          </Button>
        ) : null}
        {job.permittedActions.includes("start_oauth") && onStartOauth ? (
          <Button type="button" onClick={onStartOauth} disabled={busy}>
            {fixture ? "Connect fixture account" : "Connect with Reddit"}
          </Button>
        ) : null}
        {job.permittedActions.includes("confirm_submit") && onConfirmSubmit ? (
          <Button type="button" variant="secondary" onClick={onConfirmSubmit} disabled={busy}>
            I submitted the form myself
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
