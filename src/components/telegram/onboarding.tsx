import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, ExternalLink, LoaderCircle } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TELEGRAM_CHECKS, requiredChecksPassed } from "@/lib/telegram/checks";
import {
  telegramAwaitHelloFn,
  telegramFinishOnboardingFn,
  telegramRunAllChecksFn,
  telegramRunCheckFn,
  telegramSaveKeyFn,
  telegramStartOidcFn,
} from "@/lib/telegram/fns";
import type { TelegramOnboardingStep, TelegramStatus } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";

const STEPS: TelegramOnboardingStep[] = ["welcome", "key", "hello", "checks"];

const STEP_INDEX: Record<TelegramOnboardingStep, number> = {
  welcome: 0,
  key: 1,
  hello: 2,
  checks: 3,
  done: 4,
};

function initialStep(status: TelegramStatus | null): TelegramOnboardingStep {
  const server = status?.credential?.step ?? status?.step ?? "welcome";
  if (server === "done") return "checks";
  if (server === "welcome") return "welcome";
  return server;
}

export function TelegramOnboarding({
  status,
  displayName,
  error,
  onReady,
  onPreview,
}: {
  status: TelegramStatus | null;
  displayName?: string;
  error?: string | null;
  onReady: () => void;
  onPreview: () => void;
}) {
  const [step, setStep] = useState<TelegramOnboardingStep>(() => initialStep(status));
  const [live, setLive] = useState(status);
  const cred = live?.credential ?? status?.credential ?? null;

  useEffect(() => {
    setLive(status);
    const next = initialStep(status);
    setStep((current) => {
      if (STEP_INDEX[next] > STEP_INDEX[current]) return next;
      if (current === "welcome" && next !== "welcome") return next;
      return current;
    });
  }, [status]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">Telegram</p>
        <StepDots step={step} />
        {error ? (
          <p className="mt-4 text-sm text-down" role="alert">
            {error}
          </p>
        ) : null}

        {step === "welcome" ? (
          <WelcomeStep
            displayName={displayName}
            platformLogin={Boolean(live?.platformLogin ?? status?.platformLogin)}
            onContinue={() => setStep("key")}
            onPreview={onPreview}
          />
        ) : null}
        {step === "key" ? (
          <KeyStep
            cred={cred}
            onBack={() => setStep("welcome")}
            onSaved={(next) => {
              setLive(next);
              setStep("hello");
            }}
          />
        ) : null}
        {step === "hello" ? (
          <HelloStep
            cred={cred}
            onBack={() => setStep("key")}
            onStatus={(next) => {
              setLive(next);
              if (next.credential?.helloReceived) setStep("checks");
            }}
          />
        ) : null}
        {step === "checks" ? (
          <ChecksStep
            live={live ?? status}
            onBack={() => setStep("hello")}
            onStatus={setLive}
            onReady={onReady}
          />
        ) : null}

        <p className="mt-8 text-xs leading-relaxed text-subtle">
          Connecting Telegram is a linked identity on your studio user
          {displayName ? ` (${displayName})` : ""}. It does not replace studio sign-in.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block text-xs text-subtle transition-colors duration-[var(--motion-quick)] hover:text-fg"
        >
          All platforms
        </Link>
      </div>
    </main>
  );
}

function StepDots({ step }: { step: TelegramOnboardingStep }) {
  const active = Math.min(STEP_INDEX[step], STEPS.length - 1);
  return (
    <div className="mt-6 flex gap-1.5" aria-hidden="true">
      {STEPS.map((id, i) => (
        <span
          key={id}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-[var(--motion-quick)]",
            i <= active ? "bg-fg" : "bg-border",
          )}
        />
      ))}
    </div>
  );
}

function WelcomeStep({
  displayName,
  platformLogin,
  onContinue,
  onPreview,
}: {
  displayName?: string;
  platformLogin: boolean;
  onContinue: () => void;
  onPreview: () => void;
}) {
  const [oidcBusy, setOidcBusy] = useState(false);
  const [oidcErr, setOidcErr] = useState<string | null>(null);
  return (
    <>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Let’s set up Telegram.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {displayName ? `${displayName}, you’ll ` : "You’ll "}
        make a small helper in Telegram, say hello so we know it’s you, then we’ll check
        everything works. A few minutes. We never see your Telegram password.
      </p>
      <ol className="mt-6 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed">
        <li>
          <span className="font-mono text-xs text-subtle">01</span>
          <p className="mt-1 text-fg">Make a helper with BotFather</p>
        </li>
        <li>
          <span className="font-mono text-xs text-subtle">02</span>
          <p className="mt-1 text-fg">Open it and tap Start</p>
        </li>
        <li>
          <span className="font-mono text-xs text-subtle">03</span>
          <p className="mt-1 text-fg">Run the checks, then open your desk</p>
        </li>
      </ol>
      <div className="mt-8 grid gap-3">
        <Button type="button" size="lg" className="h-12 w-full justify-center text-base" onClick={onContinue}>
          Get started
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="h-12 w-full justify-center"
          onClick={onPreview}
        >
          Preview the desk
        </Button>
        {platformLogin ? (
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-center"
            disabled={oidcBusy}
            onClick={() => {
              setOidcBusy(true);
              setOidcErr(null);
              void telegramStartOidcFn()
                .then(({ url }) => {
                  window.location.href = url;
                })
                .catch((e: unknown) => {
                  setOidcBusy(false);
                  setOidcErr(e instanceof Error ? e.message : "Could not start Telegram login.");
                });
            }}
          >
            {oidcBusy ? "Opening Telegram…" : "Use Telegram login instead"}
          </Button>
        ) : null}
      </div>
      {oidcErr ? <p className="mt-2 text-xs text-down">{oidcErr}</p> : null}
      <p className="mt-4 text-xs leading-relaxed text-subtle">
        Preview is a local copy of the desk — it is not your Telegram account.
      </p>
    </>
  );
}

function KeyStep({
  cred,
  onBack,
  onSaved,
}: {
  cred: TelegramStatus["credential"];
  onBack: () => void;
  onSaved: (status: TelegramStatus) => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const credential = await telegramSaveKeyFn({ data: { token } });
      setToken("");
      onSaved({
        configured: true,
        mtprotoEnabled: false,
        linked: false,
        preview: false,
        onboarded: false,
        hasOwnKey: true,
        platformLogin: false,
        step: "hello",
        credential,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save that key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Back onClick={onBack} />
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Make your helper.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Telegram calls this a bot. You own it. Paste the key BotFather gives you — we keep it
        private and only use it for your desk.
      </p>
      <ol className="mt-6 grid gap-4 text-sm leading-relaxed text-muted">
        <li>
          <span className="font-mono text-xs text-subtle">1</span>
          <p className="mt-1 text-fg">Open Telegram and search BotFather.</p>
        </li>
        <li>
          <span className="font-mono text-xs text-subtle">2</span>
          <p className="mt-1 text-fg">Send /newbot and pick a name you like.</p>
        </li>
        <li>
          <span className="font-mono text-xs text-subtle">3</span>
          <p className="mt-1 text-fg">Copy the long key it sends back and paste it here.</p>
        </li>
      </ol>
      {cred?.tokenHint ? (
        <p className="mt-5 font-mono text-xs text-subtle">Saved key {cred.tokenHint}</p>
      ) : null}
      <form
        className="mt-6 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste the key here"
          autoComplete="off"
          spellCheck={false}
          name="telegram-helper-key"
          aria-label="Helper key from BotFather"
        />
        {err ? (
          <p className="text-sm text-down" role="alert">
            {err}
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-subtle">
            It looks like a long code with a colon in the middle. Never share it in a chat.
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full justify-center text-base"
          disabled={busy || token.trim().length < 20}
        >
          {busy ? "Checking…" : cred?.hasToken ? "Save a new key" : "Save key"}
        </Button>
      </form>
    </>
  );
}

function HelloStep({
  cred,
  onBack,
  onStatus,
}: {
  cred: TelegramStatus["credential"];
  onBack: () => void;
  onStatus: (status: TelegramStatus) => void;
}) {
  const [waiting, setWaiting] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const link = cred?.helloLink;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const next = await telegramAwaitHelloFn();
        if (cancelled) return;
        onStatusRef.current(next);
        if (next.credential?.helloReceived) {
          setWaiting(false);
          return;
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Still waiting.");
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <Back onClick={onBack} />
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Say hello.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Open your helper
        {cred?.botUsername ? ` (@${cred.botUsername})` : ""} and tap Start. That’s how we know
        it’s you — not a password, not a session code.
      </p>
      <div className="mt-8 grid gap-3">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent px-5 text-base font-medium text-accent-fg",
              "transition-[color,background-color,transform] duration-[var(--motion-quick)] hover:bg-accent/90 active:scale-[0.96]",
            )}
          >
            Open in Telegram
            <ExternalLink className="size-4" />
          </a>
        ) : (
          <p className="text-sm text-muted">
            Open the helper in Telegram and send Start. We’ll notice as soon as you do.
          </p>
        )}
        <div
          className="flex h-12 items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm text-muted"
          aria-live="polite"
        >
          {waiting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4 text-up" />}
          {waiting ? "Waiting for Start…" : "Hello received."}
        </div>
        {err ? <p className="text-xs text-down">{err}</p> : null}
      </div>
    </>
  );
}

function ChecksStep({
  live,
  onBack,
  onStatus,
  onReady,
}: {
  live: TelegramStatus | null;
  onBack: () => void;
  onStatus: (status: TelegramStatus) => void;
  onReady: () => void;
}) {
  const checks = live?.credential?.checks ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [finishBusy, setFinishBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const passed = requiredChecksPassed(checks);
  const requiredDone = useMemo(
    () => checks.filter((c) => TELEGRAM_CHECKS.find((m) => m.id === c.id)?.required && c.ok === true).length,
    [checks],
  );
  const requiredTotal = TELEGRAM_CHECKS.filter((c) => c.required).length;

  async function run(id: string) {
    setBusyId(id);
    setErr(null);
    try {
      onStatus(await telegramRunCheckFn({ data: { id: id as (typeof TELEGRAM_CHECKS)[number]["id"] } }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "That check didn’t run.");
    } finally {
      setBusyId(null);
    }
  }

  async function runAll() {
    setAllBusy(true);
    setErr(null);
    try {
      onStatus(await telegramRunAllChecksFn());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not run the checks.");
    } finally {
      setAllBusy(false);
    }
  }

  async function finish() {
    setFinishBusy(true);
    setErr(null);
    try {
      await telegramFinishOnboardingFn();
      onReady();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not open the desk yet.");
      setFinishBusy(false);
    }
  }

  return (
    <>
      <Back onClick={onBack} />
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Check everything works.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Press Test on each row, or run them all. When the required ones pass, your desk is
        ready.
      </p>
      <p className="mt-4 font-mono text-xs uppercase tracking-widest text-subtle">
        {requiredDone} of {requiredTotal} required
      </p>
      <ul className="mt-4 grid gap-2">
        {TELEGRAM_CHECKS.map((meta) => {
          const result = checks.find((c) => c.id === meta.id);
          const ok = result?.ok;
          return (
            <li
              key={meta.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex items-start gap-3">
                <StatusMark ok={ok ?? null} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{meta.title}</p>
                    {!meta.required ? (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                        Optional
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{meta.blurb}</p>
                  {result?.detail ? (
                    <p className={cn("mt-2 text-xs", ok ? "text-up" : ok === false ? "text-down" : "text-subtle")}>
                      {result.detail}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  disabled={allBusy || busyId === meta.id}
                  onClick={() => void run(meta.id)}
                >
                  {busyId === meta.id ? "Testing…" : ok ? "Retest" : "Test"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {err ? (
        <p className="mt-3 text-sm text-down" role="alert">
          {err}
        </p>
      ) : null}
      <div className="mt-6 grid gap-3">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="h-12 w-full justify-center"
          disabled={allBusy || Boolean(busyId)}
          onClick={() => void runAll()}
        >
          {allBusy ? "Testing all…" : "Test all"}
        </Button>
        <Button
          type="button"
          size="lg"
          className="h-12 w-full justify-center text-base"
          disabled={!passed || finishBusy}
          onClick={() => void finish()}
        >
          {finishBusy ? "Opening…" : "Open your desk"}
        </Button>
      </div>
    </>
  );
}

function StatusMark({ ok }: { ok: boolean | null }) {
  if (ok === true) {
    return (
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-up/15 text-up">
        <Check className="size-3.5" />
      </span>
    );
  }
  if (ok === false) {
    return (
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-down/40 text-down text-xs">
        !
      </span>
    );
  }
  return <span className="mt-0.5 size-6 shrink-0 rounded-full border border-border" />;
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 inline-flex h-11 items-center gap-1 text-sm text-subtle transition-colors hover:text-fg"
    >
      <ArrowLeft className="size-4" />
      Back
    </button>
  );
}
