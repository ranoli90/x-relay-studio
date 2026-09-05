import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppHeader } from "../app-header";
import { SetupApp } from "../setup-app";
import { AddAccount } from "../add-account";
import { HealthConfirm } from "../health-confirm";
import { ModeSelector } from "./mode-selector";
import { OnboardingDetails } from "./details";
import { OnboardingProgress } from "./progress";
import { OnboardingResult } from "./result";
import { HumanControl } from "./human-control";
import { SavedAccess } from "./saved-access";
import {
  cancelOnboarding,
  confirmConnectedIdentity,
  continueManualOnboarding,
  createOnboarding,
  finishOnboardingTakeover,
  getOnboardingBootstrap,
  getOnboardingEvents,
  getOnboardingJob,
  requestOnboardingTakeover,
  saveOnboardingDetails,
  startJobBoundRedditOAuth,
  startOnboarding,
} from "@/lib/reddit/onboarding/server";
import type {
  OnboardingBootstrap,
  OnboardingEventPublic,
  OnboardingJobPublic,
} from "@/lib/reddit/onboarding/types";
import { getBootstrap } from "@/lib/reddit/server";
import type { RedditAccountPublic } from "@/lib/reddit/types";
import { ASSISTANCE_CONSENT_VERSION } from "@/lib/reddit/onboarding/types";
import { Button } from "@/components/ui/button";
import { DoorSkeleton } from "@/components/screen-stack";

type Screen =
  | "chooser"
  | "details"
  | "progress"
  | "manual-return"
  | "app"
  | "oauth"
  | "health"
  | "result"
  | "control"
  | "saved";

function newKey() {
  return crypto.randomUUID();
}

export function OnboardingCoordinator({
  onFinished,
  embedded,
}: {
  onFinished: () => void;
  embedded?: boolean;
}) {
  const [boot, setBoot] = useState<OnboardingBootstrap | null>(null);
  const [job, setJob] = useState<OnboardingJobPublic | null>(null);
  const [events, setEvents] = useState<OnboardingEventPublic[]>([]);
  const [screen, setScreen] = useState<Screen>("chooser");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [selected, setSelected] = useState<"assisted" | "manual" | null>(null);
  const [pendingAccount, setPendingAccount] = useState<RedditAccountPublic | null>(null);
  const hidden = useRef(typeof document !== "undefined" ? document.hidden : false);

  const loadPendingAccount = useCallback(async (accountId?: string | null) => {
    const reddit = await getBootstrap();
    const acc = accountId
      ? reddit.accounts.find((a) => a.id === accountId)
      : reddit.accounts.find((a) => !a.onboardedAt);
    if (acc) setPendingAccount(acc);
    return acc ?? null;
  }, []);

  const loadBoot = useCallback(async () => {
    const next = await getOnboardingBootstrap();
    setBoot(next);
    if (next.currentJob) {
      setJob(next.currentJob);
      const nextScreen = screenFor(next.currentJob, next.appConfigured);
      setScreen(nextScreen);
      if (nextScreen === "health") {
        const acc = await loadPendingAccount(next.currentJob.accountId);
        if (!acc) setScreen(next.appConfigured ? "oauth" : "app");
      }
    }
  }, [loadPendingAccount]);

  useEffect(() => {
    void loadBoot().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not load Reddit setup."),
    );
  }, [loadBoot]);

  const refreshJob = useCallback(async (id: string) => {
    const next = await getOnboardingJob({ data: { jobId: id } });
    setJob(next);
    const ev = await getOnboardingEvents({ data: { jobId: id, afterSequence: 0 } });
    setEvents(ev.events);
    return next;
  }, []);

  useEffect(() => {
    if (!job || job.finishedAt) return;
    const jobId = job.id;
    const active = job.status === "running" || job.status === "queued" || job.status === "reconciling";
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      if (document.hidden) return;
      void refreshJob(jobId).catch(() => undefined);
    };
    timer = setInterval(tick, active ? 2000 : 8000);
    function onFocus() {
      void refreshJob(jobId).catch(() => undefined);
    }
    function onVis() {
      hidden.current = document.hidden;
      if (!document.hidden) onFocus();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [job, refreshJob]);

  async function begin(mode: "assisted" | "manual", intent: "create" | "connect_existing") {
    setBusy(true);
    setError(null);
    try {
      const created = await createOnboarding({
        data: {
          mode,
          intent,
          idempotencyKey: newKey(),
          correlationId: newKey(),
        },
      });
      setJob(created);
      setSelected(mode);
      setScreen(intent === "connect_existing" ? (boot?.appConfigured ? "oauth" : "app") : "details");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start setup.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAndStart(input: {
    expectedUsername?: string;
    retainContext: boolean;
    retainPassword: boolean;
    assistanceConsent: boolean;
    consentVersion: string;
  }) {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOnboardingDetails({
        data: {
          jobId: job.id,
          version: job.version,
          expectedUsername: input.expectedUsername,
          retainContext: input.retainContext,
          retainPassword: input.retainPassword,
          assistanceConsent: input.assistanceConsent,
          correlationId: newKey(),
        },
      });
      const started = await startOnboarding({
        data: {
          jobId: saved.id,
          version: saved.version,
          consentVersion: input.consentVersion || ASSISTANCE_CONSENT_VERSION,
          idempotencyKey: newKey(),
          correlationId: newKey(),
        },
      });
      setJob(started);
      setScreen(started.mode === "manual" ? "progress" : "progress");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start setup.");
    } finally {
      setBusy(false);
    }
  }

  async function reportCreated() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const next = await continueManualOnboarding({
        data: {
          jobId: job.id,
          version: job.version,
          username: username || job.expectedUsername || "user",
          ownerCreated: true,
          correlationId: newKey(),
        },
      });
      setJob(next);
      setScreen(boot?.appConfigured ? "oauth" : "app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job) return;
    if (
      !window.confirm(
        "Stop setup? An account already created on Reddit will not be deleted. We will stop the browser and remove temporary access when cleanup finishes.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const next = await cancelOnboarding({
        data: {
          jobId: job.id,
          version: job.version,
          idempotencyKey: newKey(),
          correlationId: newKey(),
        },
      });
      setJob(next);
      setScreen("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }

  if (!boot) {
    return error ? (
      <p className="px-5 py-10 text-sm text-bad">{error}</p>
    ) : (
      <DoorSkeleton />
    );
  }

  const frame = (child: ReactNode) => (
    <div className="min-h-dvh bg-bg">
      {embedded ? null : <AppHeader />}
      {child}
    </div>
  );

  if (screen === "chooser") {
    return frame(
      <>
        {boot.resumeCandidates.length ? (
          <div className="mx-auto w-full max-w-xl px-5 pt-8">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Resume</p>
            <ul className="mt-2 space-y-2">
              {boot.resumeCandidates.map((c) => (
                <li key={`${c.kind}-${c.id}`}>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full justify-start"
                    onClick={() => {
                      if (c.kind === "job") {
                        void refreshJob(c.id).then((j) => setScreen(screenFor(j, boot.appConfigured)));
                      } else {
                        void loadPendingAccount(c.id).then((acc) => {
                          if (acc) setScreen("health");
                          else onFinished();
                        });
                      }
                    }}
                  >
                    {c.label}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ModeSelector
          assistedAvailable={boot.assistedAvailable}
          assistedReason={boot.assistedUnavailableReason}
          selected={selected}
          onSelect={(mode) => {
            setSelected(mode);
            void begin(mode, "create");
          }}
          onExisting={() => void begin("manual", "connect_existing")}
        />
      </>,
    );
  }

  if (screen === "details" && job) {
    return frame(
      <OnboardingDetails
        job={job}
        sessionMaxSeconds={boot.sessionMaxSeconds}
        busy={busy}
        error={error}
        onBack={() => setScreen("chooser")}
        onSaved={(input) => void saveAndStart(input)}
      />,
    );
  }

  if (screen === "progress" && job) {
    return frame(
      <OnboardingProgress
        job={job}
        events={events}
        busy={busy}
        onTakeControl={() => {
          void requestOnboardingTakeover({
            data: { jobId: job.id, version: job.version, correlationId: newKey() },
          }).then((j) => {
            setJob(j);
            setScreen("control");
          });
        }}
        onCancel={() => void cancel()}
        onManual={() => void begin("manual", job.intent)}
        onOpenSignup={() => window.open(boot.reviewedSignupUrl, "_blank", "noopener")}
        onContinue={() => setScreen("manual-return")}
      />,
    );
  }

  if (screen === "manual-return" && job) {
    return frame(
      <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
        <h1 className="text-3xl font-medium tracking-tight">What username did you use?</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          “I created it” records what you told us. Reddit login is what proves which account is
          connected.
        </p>
        <label className="mt-6 block text-sm">
          Username
          <input
            className="mt-2 h-11 w-full rounded-md border border-border bg-surface px-3"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
        <Button className="mt-6 w-full" type="button" disabled={busy} onClick={() => void reportCreated()}>
          Continue to connect
        </Button>
      </section>,
    );
  }

  if (screen === "control" && job) {
    return frame(
      <HumanControl
        job={job}
        onFinish={() => {
          void finishOnboardingTakeover({
            data: { jobId: job.id, version: job.version, correlationId: newKey() },
          }).then((j) => {
            setJob(j);
            setScreen("progress");
          });
        }}
        onManual={() => void begin("manual", job.intent)}
      />,
    );
  }

  if (screen === "app") {
    return frame(
      <SetupApp
        onSaved={() => {
          void loadBoot().then(() => setScreen("oauth"));
        }}
      />,
    );
  }

  if (screen === "oauth" && job) {
    return frame(
      <AddAccount
        additional={Boolean(embedded)}
        expectedUsername={job.expectedUsername}
        onStart={async () => {
          const started = await startJobBoundRedditOAuth({
            data: {
              jobId: job.id,
              version: job.version,
              origin: window.location.origin,
              transport: "local",
              correlationId: newKey(),
            },
          });
          return started;
        }}
        onConnected={() => {
          void refreshJob(job.id).then(async (j) => {
            setJob(j);
            const acc = await loadPendingAccount(j.accountId);
            setScreen(acc ? "health" : "result");
          });
        }}
      />,
    );
  }

  if (screen === "health" && !pendingAccount) {
    return frame(<DoorSkeleton />);
  }

  if (screen === "health" && pendingAccount) {
    return frame(
      <HealthConfirm
        embedded
        account={pendingAccount}
        onDone={() => {
          void (async () => {
            if (job) {
              try {
                const fresh = await getOnboardingJob({ data: { jobId: job.id } });
                const next = await confirmConnectedIdentity({
                  data: {
                    jobId: fresh.id,
                    version: fresh.version,
                    confirmation:
                      "I confirm this is my Reddit account and authorize the displayed connection.",
                    correlationId: newKey(),
                  },
                });
                setJob(next);
              } catch {
                /* Account is already confirmed; job finalize is best-effort. */
              }
            }
            setScreen("result");
            onFinished();
          })();
        }}
        onRefresh={(next) => setPendingAccount(next)}
      />,
    );
  }

  if (screen === "saved" && job) {
    return frame(<SavedAccess job={job} onClose={() => setScreen("result")} />);
  }

  if (screen === "result" && job) {
    return frame(
      <OnboardingResult
        job={job}
        onDashboard={onFinished}
        onManage={() => setScreen("saved")}
        onLater={onFinished}
      />,
    );
  }

  return frame(
    <p className="px-5 py-10 text-sm text-muted">
      {error || "Choose how you want to add a Reddit account."}
    </p>,
  );
}

function screenFor(job: OnboardingJobPublic, appConfigured: boolean): Screen {
  if (job.status === "completed" || job.status === "cancelled" || job.status === "failed" || job.status === "blocked" || job.status === "expired") {
    return "result";
  }
  if (job.step === "health" || job.step === "confirm") return "health";
  if (job.step === "oauth") return appConfigured ? "oauth" : "app";
  if (job.step === "app_access" || job.step === "app_credentials") return appConfigured ? "oauth" : "app";
  if (job.controlOwner === "user" || job.status === "needs_user") return job.step === "verify_account" ? "control" : "progress";
  if (job.status === "draft") return "details";
  return "progress";
}

export { startJobBoundRedditOAuth };
