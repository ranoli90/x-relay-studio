import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OnboardingJobPublic } from "@/lib/reddit/onboarding/types";
import { ASSISTANCE_CONSENT_VERSION } from "@/lib/reddit/onboarding/types";

export function OnboardingDetails({
  job,
  sessionMaxSeconds,
  onBack,
  onSaved,
  busy,
  error,
}: {
  job: OnboardingJobPublic;
  sessionMaxSeconds: number;
  onBack: () => void;
  onSaved: (input: {
    expectedUsername?: string;
    retainContext: boolean;
    retainPassword: boolean;
    assistanceConsent: boolean;
    consentVersion: string;
  }) => void;
  busy: boolean;
  error: string | null;
}) {
  const [username, setUsername] = useState(job.expectedUsername ?? "");
  const minutes = Math.round(sessionMaxSeconds / 60);

  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Account details</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">Review what we will use</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        We only collect a username when this signup asks for one. Age checks and Reddit’s terms stay
        on Reddit. A hosted browser processes the session even when recording is off.
      </p>

      <label className="mt-8 block text-sm">
        Desired username
        <input
          className="mt-2 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          maxLength={20}
        />
      </label>

      {job.mode === "assisted" ? (
        <p className="mt-6 text-sm leading-relaxed text-muted">
          Guided setup uses the configured browser allowance, up to {minutes} minutes. Optional
          storage stays off. Age checks and Reddit’s terms stay on Reddit.
        </p>
      ) : (
        <p className="mt-6 text-sm leading-relaxed text-muted">
          Manual setup does not start a hosted browser. Creating a Reddit account does not connect it
          to X Relay. App access may require Reddit approval.
        </p>
      )}

      {error ? <p className="mt-4 text-sm text-bad">{error}</p> : null}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button type="button" variant="secondary" className="flex-1" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={busy}
          onClick={() =>
            onSaved({
              expectedUsername: username || undefined,
              retainContext: false,
              retainPassword: false,
              assistanceConsent: job.mode === "assisted",
              consentVersion: ASSISTANCE_CONSENT_VERSION,
            })
          }
        >
          {busy ? "Saving…" : job.mode === "assisted" ? "Start guided setup" : "Continue"}
        </Button>
      </div>
    </section>
  );
}
