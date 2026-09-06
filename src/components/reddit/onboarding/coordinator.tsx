import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppHeader } from "../app-header";
import { SetupApp } from "../setup-app";
import { AddAccount } from "../add-account";
import { HealthConfirm } from "../health-confirm";
import { ModeSelector } from "./mode-selector";
import { OnboardingDetails } from "./details";
import { OnboardingProgress } from "./progress";
import { OnboardingResult } from "./result";
import { HumanControl, type ControlViewState } from "./human-control";
import { SavedAccess } from "./saved-access";
import { SteelHostCard } from "./steel-host";
import {
  cancelOnboarding,
  confirmConnectedIdentity,
  continueManualOnboarding,
  createOnboarding,
  disconnectOnboardingSteelHost,
  finishOnboardingTakeover,
  getOnboardingBootstrap,
  getOnboardingEvents,
  getOnboardingJob,
  requestOnboardingTakeover,
  saveOnboardingDetails,
  saveOnboardingSteelHost,
  startJobBoundRedditOAuth,
  startOnboarding,
  handoffOnboardingToManual,
  completeFixtureOnboarding,
  confirmSignupSubmission,
  getOnboardingControlView,
  startIsolatedOnboarding,
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

type KeyPair = { idempotencyKey: string; correlationId: string };

function rememberKey(store: Map<string, KeyPair>, op: string): KeyPair {
  const existing = store.get(op);
  if (existing) return existing;
  const pair = { idempotencyKey: newKey(), correlationId: newKey() };
  store.set(op, pair);
  return pair;
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
  const [controlView, setControlView] = useState<ControlViewState | null>(null);
  const [steelBusy, setSteelBusy] = useState(false);
  const [steelError, setSteelError] = useState<string | null>(null);
  const hidden = useRef(typeof document !== "undefined" ? document.hidden : false);
  const opKeys = useRef(new Map<string, KeyPair>());
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

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
      const leftoverCreate =
        next.fixtureEnabled &&
        next.ownerKicksCompleted &&
        next.currentJob.intent === "create" &&
        !["completed", "cancelled", "failed", "blocked", "expired"].includes(next.currentJob.status);
      if (leftoverCreate) {
        try {
          const finished = await completeFixtureOnboarding({
            data: {
              jobId: next.currentJob.id,
              version: next.currentJob.version,
              username: next.currentJob.expectedUsername || undefined,
              correlationId: `resume-${next.currentJob.id}`,
            },
          });
          setJob(finished);
          setBoot({ ...next, ownerKicksCompleted: true });
          setScreen("result");
          onFinishedRef.current();
          return;
        } catch {
          /* fall through */
        }
      }
      const nextScreen = screenFor(next.currentJob, next.appConfigured, next.fixtureEnabled);
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

  useEffect(() => {
    if (screen !== "control" || !job) return;
    if (boot?.fixtureEnabled) {
      setControlView({
        available: true,
        url: "/__reddit-onboarding-fixture/index.html",
        kind: "fixture",
        fixture: true,
      });
      return;
    }
    let cancelled = false;
    const current = job;
    void (async () => {
      let next = current;
      if (next.controlOwner !== "user" && next.permittedActions.includes("request_takeover")) {
        try {
          next = await requestOnboardingTakeover({
            data: {
              jobId: next.id,
              version: next.version,
              correlationId: rememberKey(opKeys.current, `takeover:${next.id}`).correlationId,
            },
          });
          if (!cancelled) setJob(next);
        } catch {
          /* still try to load a view */
        }
      }
      try {
        const view = await getOnboardingControlView({
          data: {
            jobId: next.id,
            version: next.version,
            correlationId: rememberKey(opKeys.current, `view:${next.id}`).correlationId,
          },
        });
        if (!cancelled) setControlView(view);
      } catch {
        if (!cancelled) {
          setControlView({
            available: false,
            url: null,
            kind: "none",
            reason: "Open Reddit and tap this same control on the real page.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, job?.id, boot?.fixtureEnabled]);

  const refreshJob = useCallback(async (id: string) => {
    const next = await getOnboardingJob({ data: { jobId: id } });
    setJob(next);
    const ev = await getOnboardingEvents({ data: { jobId: id, afterSequence: 0 } });
    setEvents(ev.events);
    if (boot) setScreen(screenFor(next, boot.appConfigured || Boolean(boot.fixtureEnabled), boot.fixtureEnabled));
    return next;
  }, [boot]);

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
    const op = `create:${mode}:${intent}`;
    const keys = rememberKey(opKeys.current, op);
    try {
      if (boot?.fixtureEnabled) {
        if (intent === "connect_existing") {
          const started = await startIsolatedOnboarding({
            data: {
              mode,
              intent,
              idempotencyKey: keys.idempotencyKey,
              correlationId: keys.correlationId,
            },
          });
          const finished = await completeFixtureOnboarding({
            data: {
              jobId: started.id,
              version: started.version,
              username: started.expectedUsername || undefined,
              correlationId: keys.correlationId,
            },
          });
          opKeys.current.delete(op);
          setJob(finished);
          if (finished.expectedUsername) setUsername(finished.expectedUsername);
          setScreen("result");
          onFinishedRef.current();
          return;
        }
        const started = await startIsolatedOnboarding({
          data: {
            mode,
            intent,
            idempotencyKey: keys.idempotencyKey,
            correlationId: keys.correlationId,
          },
        });
        opKeys.current.delete(op);
        setJob(started);
        if (started.expectedUsername) setUsername(started.expectedUsername);
        if (started.status === "completed") {
          setBoot({ ...boot, ownerKicksCompleted: true });
          setScreen("result");
          onFinishedRef.current();
          return;
        }
        setScreen("control");
        return;
      }
      const created = await createOnboarding({
        data: {
          mode,
          intent,
          idempotencyKey: keys.idempotencyKey,
          correlationId: keys.correlationId,
        },
      });
      let next = created;
      if (intent === "connect_existing") {
        next = await startOnboarding({
          data: {
            jobId: created.id,
            version: created.version,
            consentVersion: ASSISTANCE_CONSENT_VERSION,
            idempotencyKey: keys.idempotencyKey,
            correlationId: keys.correlationId,
          },
        });
      }
      if (mode === "assisted" && intent === "create") {
        const generated = `relay${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
        await saveAndStart(
          {
            expectedUsername: generated,
            retainContext: false,
            retainPassword: false,
            assistanceConsent: true,
            consentVersion: ASSISTANCE_CONSENT_VERSION,
          },
          created,
        );
        return;
      }
      opKeys.current.delete(op);
      setJob(next);
      setSelected(mode);
      setScreen(
        intent === "connect_existing"
          ? boot?.appConfigured || boot?.fixtureEnabled
            ? "oauth"
            : "app"
          : "details",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start setup.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAndStart(
    input: {
      expectedUsername?: string;
      retainContext: boolean;
      retainPassword: boolean;
      assistanceConsent: boolean;
      consentVersion: string;
    },
    fromJob?: OnboardingJobPublic,
  ) {
    const current = fromJob || job;
    if (!current) return;
    setBusy(true);
    setError(null);
    const op = `start:${current.id}`;
    const keys = rememberKey(opKeys.current, op);
    try {
      const saved = await saveOnboardingDetails({
        data: {
          jobId: current.id,
          version: current.version,
          expectedUsername: input.expectedUsername,
          retainContext: input.retainContext,
          retainPassword: input.retainPassword,
          assistanceConsent: input.assistanceConsent,
          correlationId: keys.correlationId,
        },
      });
      const started = await startOnboarding({
        data: {
          jobId: saved.id,
          version: saved.version,
          consentVersion: input.consentVersion || ASSISTANCE_CONSENT_VERSION,
          idempotencyKey: keys.idempotencyKey,
          correlationId: keys.correlationId,
        },
      });
      opKeys.current.delete(op);
      setJob(started);
      if (input.expectedUsername) setUsername(input.expectedUsername);
      setScreen("progress");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start setup.");
    } finally {
      setBusy(false);
    }
  }

  async function reportCreated() {
    if (!job) return;
    const reported = (username.trim() || job.expectedUsername || "").replace(/^u\//i, "");
    if (reported.length < 3) {
      setError("Enter the username you used. We will not guess.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await continueManualOnboarding({
        data: {
          jobId: job.id,
          version: job.version,
          username: reported,
          ownerCreated: true,
          correlationId: rememberKey(opKeys.current, `continue:${job.id}`).correlationId,
        },
      });
      opKeys.current.delete(`continue:${job.id}`);
      setJob(next);
      setScreen(boot?.appConfigured ? "oauth" : "app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function handoffManual() {
    if (!job) return;
    setBusy(true);
    setError(null);
    const op = `handoff:${job.id}`;
    const keys = rememberKey(opKeys.current, op);
    try {
      const next = await handoffOnboardingToManual({
        data: { jobId: job.id, version: job.version, correlationId: keys.correlationId },
      });
      opKeys.current.delete(op);
      setJob(next);
      setScreen("progress");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch to manual.");
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
      const keys = rememberKey(opKeys.current, `cancel:${job.id}`);
      const next = await cancelOnboarding({
        data: {
          jobId: job.id,
          version: job.version,
          idempotencyKey: keys.idempotencyKey,
          correlationId: keys.correlationId,
        },
      });
      opKeys.current.delete(`cancel:${job.id}`);
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
                        void refreshJob(c.id).then((j) => setScreen(screenFor(j, boot.appConfigured, boot.fixtureEnabled)));
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
          ownerKicksCompleted={boot.ownerKicksCompleted}
          selected={selected}
          onSelect={(mode) => {
            setSelected(mode);
            void begin(mode, "create");
          }}
          onExisting={() => void begin("manual", "connect_existing")}
        />
        {boot.steelHost ? (
        <SteelHostCard
          host={boot.steelHost}
          busy={steelBusy}
          error={steelError}
          onSave={async (apiKey) => {
            setSteelBusy(true);
            setSteelError(null);
            try {
              const next = await saveOnboardingSteelHost({ data: { apiKey } });
              setBoot({ ...boot, steelHost: next });
            } catch (e) {
              const message = e instanceof Error ? e.message : "Could not connect Steel.";
              setSteelError(message);
              throw e;
            } finally {
              setSteelBusy(false);
            }
          }}
          onDisconnect={async () => {
            setSteelBusy(true);
            setSteelError(null);
            try {
              const next = await disconnectOnboardingSteelHost();
              setBoot({ ...boot, steelHost: next });
            } catch (e) {
              setSteelError(e instanceof Error ? e.message : "Could not disconnect Steel.");
            } finally {
              setSteelBusy(false);
            }
          }}
        />
        ) : null}
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
        fixture={Boolean(boot.fixtureEnabled)}
        onTakeControl={() => {
          void requestOnboardingTakeover({
            data: { jobId: job.id, version: job.version, correlationId: rememberKey(opKeys.current, `takeover:${job.id}`).correlationId },
          }).then((j) => {
            setJob(j);
            setScreen("control");
          }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not take control."));
        }}
        onCancel={() => void cancel()}
        onManual={() => void handoffManual()}
        onOpenSignup={() =>
          window.open(
            boot.fixtureEnabled ? "/__reddit-onboarding-fixture/index.html" : boot.reviewedSignupUrl,
            "_blank",
            "noopener",
          )
        }
        onContinue={() => setScreen("manual-return")}
        onStartOauth={() => setScreen(boot.appConfigured || boot.fixtureEnabled ? "oauth" : "app")}
        onConfirmSubmit={() => {
          const keys = rememberKey(opKeys.current, `submit:${job.id}`);
          void confirmSignupSubmission({
            data: {
              jobId: job.id,
              version: job.version,
              confirmation: "owner-submitted-form",
              correlationId: keys.correlationId,
            },
          })
            .then((j) => {
              setJob(j);
              setScreen("manual-return");
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not record that."));
        }}
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
            value={username || job.expectedUsername || ""}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
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
        fixture={Boolean(boot.fixtureEnabled)}
        signupUrl={boot.reviewedSignupUrl}
        view={
          controlView ||
          (boot.fixtureEnabled
            ? { available: true, url: "/__reddit-onboarding-fixture/index.html", kind: "fixture", fixture: true }
            : { available: false, kind: "none" })
        }
        onFinish={() => {
          if (boot.fixtureEnabled) {
            setBusy(true);
            void completeFixtureOnboarding({
              data: {
                jobId: job.id,
                version: job.version,
                username: username || job.expectedUsername || undefined,
                correlationId: rememberKey(opKeys.current, `fixture:${job.id}`).correlationId,
              },
            })
              .then((j) => {
                setJob(j);
                setBoot({ ...boot, ownerKicksCompleted: true });
                setScreen("result");
                onFinishedRef.current();
              })
              .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : "Could not finish the practice account."),
              )
              .finally(() => setBusy(false));
            return;
          }
          const keys = rememberKey(opKeys.current, `submit:${job.id}`);
          void confirmSignupSubmission({
            data: {
              jobId: job.id,
              version: job.version,
              confirmation: "owner-submitted-form",
              correlationId: keys.correlationId,
            },
          })
            .then(async (j) => {
              let next = j;
              if (j.controlOwner === "user") {
                next = await finishOnboardingTakeover({
                  data: {
                    jobId: j.id,
                    version: j.version,
                    correlationId: rememberKey(opKeys.current, `end-takeover:${j.id}`).correlationId,
                  },
                });
              }
              setJob(next);
              setScreen("manual-return");
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not record that."));
        }}
        onManual={() => void handoffManual()}
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
      boot.fixtureEnabled ? (
        <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
          <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Isolated fixture</p>
          <h1 className="mt-4 text-3xl font-medium tracking-tight">Connect the test account</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This preview does not talk to Reddit. Connecting stores a local fixture identity so you
            can finish health and the dashboard. CAPTCHA, terms, and live login stay owner actions
            on the real site.
          </p>
          <label className="mt-6 block text-sm">
            Username
            <input
              className="mt-2 h-11 w-full rounded-md border border-border bg-surface px-3"
              value={username || job.expectedUsername || ""}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
          <Button
            className="mt-6 w-full"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void completeFixtureOnboarding({
                data: {
                  jobId: job.id,
                  version: job.version,
                  username: username || job.expectedUsername || undefined,
                  correlationId: rememberKey(opKeys.current, `fixture:${job.id}`).correlationId,
                },
              })
                .then(async (j) => {
                  setJob(j);
                  setScreen("result");
                  onFinished();
                })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not connect the fixture account."))
                .finally(() => setBusy(false));
            }}
          >
            Connect fixture account
          </Button>
        </section>
      ) : (
      <AddAccount
        additional={Boolean(embedded)}
        expectedUsername={job.expectedUsername}
        onStart={async () => {
          const keys = rememberKey(opKeys.current, `oauth:${job.id}`);
          const started = await startJobBoundRedditOAuth({
            data: {
              jobId: job.id,
              version: job.version,
              origin: window.location.origin,
              transport: "local",
              correlationId: keys.correlationId,
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
      />
      ),
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
                    correlationId: rememberKey(opKeys.current, `confirm:${fresh.id}`).correlationId,
                  },
                });
                setJob(next);
              } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Could not finish setup confirmation.");
                return;
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

function screenFor(job: OnboardingJobPublic, appConfigured: boolean, fixture = false): Screen {
  if (job.status === "completed" || job.status === "cancelled" || job.status === "failed" || job.status === "blocked" || job.status === "expired") {
    return "result";
  }
  if (job.step === "health" || job.step === "confirm") return "health";
  if (job.step === "oauth") return appConfigured ? "oauth" : "app";
  if (job.step === "app_access" || job.step === "app_credentials") return appConfigured ? "oauth" : "app";
  if (
    job.intent === "create" &&
    job.status === "needs_user" &&
    (job.step === "verify_account" || job.step === "create_account")
  ) {
    return "control";
  }
  if (job.controlOwner === "user") return "control";
  if (job.status === "draft") return job.intent === "connect_existing" ? (appConfigured || fixture ? "oauth" : "app") : "details";
  return "progress";
}

export { startJobBoundRedditOAuth };
