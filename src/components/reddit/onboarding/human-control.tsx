import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import type { OnboardingJobPublic } from "@/lib/reddit/onboarding/types";
import {
  captureOnboardingLiveFrame,
  sendOnboardingLiveInput,
} from "@/lib/reddit/onboarding/server";
import {
  FIXTURE_KICK_MESSAGE,
  PARENT_KICK_MESSAGE,
  fixtureKickUrl,
  type OwnerKickId,
} from "@/lib/reddit/onboarding/kick-steps";

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
  fixture,
  signupUrl,
}: {
  job: OnboardingJobPublic;
  onFinish: () => void;
  onManual: () => void;
  view?: ControlViewState | null;
  fixture?: boolean;
  signupUrl?: string | null;
}) {
  const kind = view?.kind || (view?.url ? "embed" : fixture ? "fixture" : "none");
  const isFixture = kind === "fixture" || Boolean(fixture || view?.fixture);

  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Your turn</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        Create this Reddit account.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Open Reddit and create the account. Come back and continue with the username you used.
      </p>
      {job.expectedUsername ? (
        <p className="mt-2 font-mono text-xs text-subtle">Suggested username u/{job.expectedUsername}</p>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
        {isFixture ? (
          <FixtureKickFrame
            job={job}
            step="final_submit"
            completed={[]}
            onKick={() => onFinish()}
          />
        ) : kind === "local" && view?.sessionId ? (
          <LocalLiveCanvas jobId={job.id} sessionId={view.sessionId} />
        ) : view?.url ? (
          <iframe title="Reddit in the hosted browser" src={view.url} className="h-[28rem] w-full bg-bg" />
        ) : (
          <div className="px-5 py-10">
            <p className="text-sm leading-relaxed text-muted">
              {view?.reason || "Open Reddit signup, create the account, then continue here."}
            </p>
            {signupUrl ? (
              <Button
                type="button"
                className="mt-5 w-full"
                onClick={() => window.open(signupUrl, "_blank", "noopener")}
              >
                Open Reddit signup
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <Button type="button" className="mt-6 w-full" onClick={onFinish}>
        I created it — continue
      </Button>

      <div className="mt-6 flex flex-col gap-2 sm:max-w-xl">
        <Button type="button" variant="ghost" onClick={onManual}>
          Use manual instead
        </Button>
      </div>
    </section>
  );
}

function FixtureKickFrame({
  job,
  step,
  completed,
  onKick,
}: {
  job: OnboardingJobPublic;
  step: OwnerKickId;
  completed: OwnerKickId[];
  onKick: (step: OwnerKickId) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onKickRef = useRef(onKick);
  onKickRef.current = onKick;
  const src = useMemo(
    () => fixtureKickUrl({ username: job.expectedUsername, step: "final_submit" }),
    [job.expectedUsername],
  );

  function tellChild() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: PARENT_KICK_MESSAGE,
        show: step,
        completed,
        username: job.expectedUsername,
      },
      window.location.origin,
    );
  }

  const tellRef = useRef(tellChild);
  tellRef.current = tellChild;

  useEffect(() => {
    tellChild();
  }, [step, job.expectedUsername, completed.join(",")]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== FIXTURE_KICK_MESSAGE) return;
      if (data.event === "ready") {
        tellRef.current();
        return;
      }
      if (data.event === "created" || (data.event === "kick" && data.step === "final_submit")) {
        onKickRef.current("final_submit");
        return;
      }
      if (data.event === "kick" && typeof data.step === "string") {
        onKickRef.current(data.step as OwnerKickId);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="Reddit control"
      src={src}
      className="block h-[14.5rem] w-full bg-bg"
      onLoad={tellChild}
    />
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
    <div className="bg-surface-2">
      {src ? (
        <img
          src={src}
          alt="Hosted Reddit page"
          className="block h-auto w-full cursor-crosshair"
          onClick={(event) => {
            const { x, y } = coords(event);
            void sendOnboardingLiveInput({ data: { jobId, sessionId, action: "click", x, y } }).catch(
              (e: unknown) => setError(e instanceof Error ? e.message : "Click was not delivered."),
            );
          }}
        />
      ) : (
        <p className="px-4 py-16 text-center text-sm text-muted">Opening the hosted browser…</p>
      )}
      {error ? <p className="px-4 py-2 text-xs text-bad">{error}</p> : null}
    </div>
  );
}
