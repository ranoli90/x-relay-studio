import { useEffect, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import type { OnboardingJobPublic } from "@/lib/reddit/onboarding/types";
import {
  captureOnboardingLiveFrame,
  sendOnboardingLiveInput,
} from "@/lib/reddit/onboarding/server";

export type ControlViewState = {
  available: boolean;
  url?: string | null;
  sessionId?: string | null;
  kind?: "fixture" | "local" | "embed" | "none";
  reason?: string | null;
  fixture?: boolean;
};

export function HumanControl({
  job,
  onFinish,
  onManual,
  view,
}: {
  job: OnboardingJobPublic;
  onFinish: () => void;
  onManual: () => void;
  view?: ControlViewState | null;
}) {
  const kind = view?.kind || (view?.url ? "embed" : "none");
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Your control</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        {job.waitReason || "Reddit needs you to continue"}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Verification codes stay in your email or phone. We do not store them or send them to a model.
        CAPTCHA, terms, and the final create click are yours. We will not complete those steps.
      </p>
      {kind === "local" && view?.sessionId ? (
        <LocalLiveCanvas jobId={job.id} sessionId={view.sessionId} />
      ) : view?.url ? (
        <div className="mt-6 overflow-hidden rounded-xl border border-border">
          <iframe title="Browser session" src={view.url} className="h-[32rem] w-full bg-bg" />
        </div>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          {view?.reason ||
            "If you submit the form yourself, tell us so we can check the result. We will not submit again."}
        </p>
      )}
      <div className="mt-8 flex flex-col gap-3 sm:max-w-xl">
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

function LocalLiveCanvas({ jobId, sessionId }: { jobId: string; sessionId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    async function tick() {
      try {
        const frame = await captureOnboardingLiveFrame({ data: { jobId, sessionId } });
        if (cancelled) return;
        setSrc(`data:image/jpeg;base64,${frame.jpeg}`);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Live view paused.");
      }
      if (!cancelled) timer = window.setTimeout(tick, 700);
    }
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId, sessionId]);

  function coords(event: MouseEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    const rect = img.getBoundingClientRect();
    const scaleX = (img.naturalWidth || 800) / rect.width;
    const scaleY = (img.naturalHeight || 600) / rect.height;
    return {
      x: Math.round((event.clientX - rect.left) * scaleX),
      y: Math.round((event.clientY - rect.top) * scaleY),
    };
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-black">
      {src ? (
        <img
          src={src}
          alt="Self-hosted browser"
          className="block h-auto w-full cursor-crosshair"
          onClick={(event) => {
            const { x, y } = coords(event);
            void sendOnboardingLiveInput({ data: { jobId, sessionId, action: "click", x, y } }).catch(
              (e: unknown) => setError(e instanceof Error ? e.message : "Click was not delivered."),
            );
          }}
        />
      ) : (
        <p className="px-4 py-16 text-center text-sm text-muted">Opening the local browser…</p>
      )}
      {error ? <p className="px-4 py-2 text-xs text-bad">{error}</p> : null}
      <p className="px-4 py-2 text-xs text-muted">Click the page to type later in the real fields. Owner-only steps stay yours.</p>
    </div>
  );
}
