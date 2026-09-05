import { Button } from "@/components/ui/button";
import type { OnboardingJobPublic } from "@/lib/reddit/onboarding/types";

export function HumanControl({
  job,
  onFinish,
  onManual,
}: {
  job: OnboardingJobPublic;
  onFinish: () => void;
  onManual: () => void;
}) {
  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Your control</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        {job.waitReason || "Reddit needs you to continue"}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Verification codes stay in your email or phone. We do not store them or send them to a model.
        Embedded typing on phones is not assumed to work — use Reddit in your own browser if this
        view cannot take input.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        If you submit the form yourself, tell us so we can check the result. We will not submit again.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <Button type="button" onClick={onFinish}>
          I finished this step
        </Button>
        <Button type="button" variant="secondary" onClick={onManual}>
          Use manual instead
        </Button>
      </div>
    </section>
  );
}
