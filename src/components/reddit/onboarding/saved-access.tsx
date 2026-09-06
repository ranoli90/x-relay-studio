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

function browserCopy(job: OnboardingJobPublic): string {
  const status = job.retentionStatus;
  const expiry = formatExpiry(job.retentionExpiresAt);
  if (status === "retained") {
    return expiry
      ? `Retained until ${expiry}.`
      : "Retained after persistence was confirmed.";
  }
  if (status === "requested" || (job.retainContext && !status)) {
    return "Retention requested. Not saved until persistence is confirmed.";
  }
  if (status === "delete_pending") {
    return "Deletion requested. Waiting for confirmation.";
  }
  if (status === "deleted") {
    return "Retained sign-in deleted.";
  }
  if (status === "expired") {
    return expiry ? `Expired at ${expiry}.` : "Retention expired.";
  }
  if (status === "needs_reauth") {
    return "Needs the same Reddit account to sign in again.";
  }
  if (status === "temporary") {
    return "Temporary browser state. Not retained.";
  }
  return "Browser sign-in is not retained.";
}

export function SavedAccess({
  job,
  onClose,
}: {
  job: OnboardingJobPublic;
  onClose: () => void;
}) {
  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Saved access</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">What is stored</h1>
      <ul className="mt-6 space-y-3 text-sm leading-relaxed text-muted">
        <li>OAuth tokens stay encrypted on the server. They are never shown here.</li>
        <li>Browser sign-in: {browserCopy(job)}</li>
        <li>Password: {job.retainPassword ? "opted in and encrypted" : "not stored"}.</li>
      </ul>
      <Button type="button" className="mt-8 w-full" onClick={onClose}>
        Back
      </Button>
    </section>
  );
}
