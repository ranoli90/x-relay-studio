import { Button } from "@/components/ui/button";
import type { OnboardingJobPublic } from "@/lib/reddit/onboarding/types";

function formatExpiry(value: string | null): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function OnboardingResult({
  job,
  onDashboard,
  onManage,
  onLater,
}: {
  job: OnboardingJobPublic;
  onDashboard: () => void;
  onManage: () => void;
  onLater: () => void;
}) {
  const identified = Boolean(job.verifiedUsername);
  const retained = job.retentionStatus === "retained";
  const expiry = retained ? formatExpiry(job.retentionExpiresAt) : null;
  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16" data-testid="onboarding-result">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Result</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">What is actually done</h1>
      <ul className="mt-8 space-y-3">
        <ResultCard
          title="Account identified"
          ok={identified}
          detail={
            job.verifiedUsername
              ? `u/${job.verifiedUsername}`
              : job.expectedUsername
                ? `Owner-reported u/${job.expectedUsername} — not verified until Reddit login.`
                : "No account identity yet. A creation outcome is not identity."
          }
        />
        <ResultCard
          title="Connection verified"
          ok={job.connectionState === "verified"}
          detail={
            job.connectionState === "verified"
              ? "OAuth identity matched and tokens were stored."
              : "A form interaction or welcome screen is not a connection."
          }
        />
        <ResultCard
          title="Browser sign-in saved"
          ok={retained}
          detail={
            retained
              ? expiry
                ? `Retained until ${expiry}.`
                : "Retained after persistence was confirmed."
              : job.retentionStatus === "requested" || job.retainContext
                ? "Retention was requested. It is not saved until persistence is confirmed."
                : "Temporary browser state is not kept."
          }
        />
      </ul>
      {job.cleanupSummary ? <p className="mt-4 text-sm text-muted">{job.cleanupSummary}</p> : null}
      <div className="mt-8 flex flex-col gap-3">
        <Button type="button" onClick={onDashboard}>
          Open Reddit dashboard
        </Button>
        <Button type="button" variant="secondary" onClick={onManage}>
          Manage saved access
        </Button>
        {job.connectionState !== "verified" ? (
          <Button type="button" variant="ghost" onClick={onLater}>
            Finish later
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ResultCard({ title, ok, detail }: { title: string; ok: boolean; detail: string }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4" data-testid={`result-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <p className="text-sm font-medium">
        {title}{" "}
        <span className={ok ? "text-ok" : "text-muted"}>{ok ? "yes" : "not yet"}</span>
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{detail}</p>
    </li>
  );
}
