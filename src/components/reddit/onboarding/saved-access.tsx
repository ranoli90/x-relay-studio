import { Button } from "@/components/ui/button";
import type { OnboardingJobPublic } from "@/lib/reddit/onboarding/types";

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
        <li>
          Browser sign-in: {job.retainContext ? "opted in, with a deletion date" : "not retained"}.
        </li>
        <li>Password: {job.retainPassword ? "opted in and encrypted" : "not stored"}.</li>
      </ul>
      <Button type="button" className="mt-8 w-full" onClick={onClose}>
        Back
      </Button>
    </section>
  );
}
