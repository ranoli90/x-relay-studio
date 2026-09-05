import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TELEGRAM_CHECKS, requiredChecksPassed } from "@/lib/telegram/checks";
import { TELEGRAM_APP_FORM, appFormUrl, titleLooksOfficial } from "@/lib/telegram/app-form";
import {
  clearOnboardingDraft,
  mergeOnboardingStep,
  readOnboardingDraft,
  writeOnboardingDraft,
} from "@/lib/telegram/onboarding-draft";
import {
  telegramFinishOnboardingFn,
  telegramRunAllChecksFn,
  telegramStartLoginFn,
  telegramSubmitCodeFn,
  telegramSubmitPasswordFn,
} from "@/lib/telegram/fns";
import type { TelegramOnboardingStep, TelegramStatus } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";

const STEPS: TelegramOnboardingStep[] = ["welcome", "app", "phone", "code", "password", "checks"];

function initialStep(status: TelegramStatus | null): TelegramOnboardingStep {
  const server = status?.watch
    ? status.step
    : (status?.step ?? "welcome");
  if (server === "done") return "checks";
  if (server === "welcome") return "welcome";
  if (STEPS.includes(server)) return server;
  return "welcome";
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
  const draft = typeof window !== "undefined" ? readOnboardingDraft() : null;
  const [step, setStep] = useState<TelegramOnboardingStep>(() =>
    mergeOnboardingStep(initialStep(status), draft?.step ?? null),
  );
  const [live, setLive] = useState(status);
  const [apiId, setApiId] = useState(draft?.apiId ?? "");
  const [apiHash, setApiHash] = useState(draft?.apiHash ?? "");
  const [phone, setPhone] = useState(draft?.phone ?? "");
  const needsAppKeys = Boolean(live?.needsAppKeys ?? status?.needsAppKeys);

  useEffect(() => {
    setLive(status);
    const next = initialStep(status);
    setStep((current) => mergeOnboardingStep(next, current));
  }, [status]);

  useEffect(() => {
    if (step === "done") {
      clearOnboardingDraft();
      return;
    }
    writeOnboardingDraft({ step, apiId, apiHash, phone });
  }, [step, apiId, apiHash, phone]);

  useEffect(() => {
    const flush = () => writeOnboardingDraft({ step, apiId, apiHash, phone });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [step, apiId, apiHash, phone]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">Telegram</p>
        <StepDots step={step} needsAppKeys={needsAppKeys} />
        {error ? (
          <p className="mt-4 text-sm text-down" role="alert">
            {error}
          </p>
        ) : null}

        {step === "welcome" ? (
          <WelcomeStep
            displayName={displayName}
            needsAppKeys={needsAppKeys}
            persistent={live?.persistent ?? status?.persistent ?? true}
            onContinue={() => setStep(needsAppKeys ? "app" : "phone")}
            onPreview={onPreview}
          />
        ) : null}
        {step === "app" ? (
          <AppKeysStep
            apiId={apiId}
            apiHash={apiHash}
            onApiId={setApiId}
            onApiHash={setApiHash}
            onBack={() => setStep("welcome")}
            onContinue={() => setStep("phone")}
          />
        ) : null}
        {step === "phone" ? (
          <PhoneStep
            needsAppKeys={needsAppKeys}
            apiId={apiId}
            apiHash={apiHash}
            phone={phone}
            onPhone={setPhone}
            phoneHint={live?.watch?.phoneHint ?? status?.watch?.phoneHint}
            onBack={() => setStep(needsAppKeys ? "app" : "welcome")}
            onSent={(next) => {
              setLive(next);
              setStep(next.step === "password" ? "password" : "code");
            }}
          />
        ) : null}
        {step === "code" ? (
          <CodeStep
            phoneHint={live?.watch?.phoneHint ?? status?.watch?.phoneHint}
            onBack={() => setStep("phone")}
            onStatus={(next) => {
              setLive(next);
              if (next.watch?.needsPassword || next.step === "password") setStep("password");
              else if (next.linked || next.watch?.hasSession) setStep("checks");
            }}
          />
        ) : null}
        {step === "password" ? (
          <PasswordStep
            onBack={() => setStep("code")}
            onStatus={(next) => {
              setLive(next);
              if (next.linked || next.watch?.hasSession) setStep("checks");
            }}
          />
        ) : null}
        {step === "checks" ? (
          <ChecksStep
            status={live ?? status}
            onBack={() => setStep(live?.watch?.needsPassword ? "password" : "code")}
            onStatus={setLive}
            onReady={() => {
              clearOnboardingDraft();
              onReady();
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

function StepDots({ step, needsAppKeys }: { step: TelegramOnboardingStep; needsAppKeys: boolean }) {
  const visible = needsAppKeys ? STEPS : STEPS.filter((id) => id !== "app");
  const idx = visible.indexOf(step);
  return (
    <ol className="mt-6 flex gap-1.5" aria-label="Setup steps">
      {visible.map((id, i) => (
        <li
          key={id}
          className={cn(
            "h-1 flex-1 rounded-full",
            i <= Math.max(idx, 0) ? "bg-accent" : "bg-surface-2",
          )}
        />
      ))}
    </ol>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-6 inline-flex items-center gap-1 text-xs text-subtle hover:text-fg"
    >
      <ArrowLeft className="size-3.5" />
      Back
    </button>
  );
}

function WelcomeStep({
  displayName,
  needsAppKeys,
  persistent,
  onContinue,
  onPreview,
}: {
  displayName?: string;
  needsAppKeys: boolean;
  persistent: boolean;
  onContinue: () => void;
  onPreview: () => void;
}) {
  return (
    <>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Connect your Telegram.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {displayName ? `${displayName}, this ` : "This "}
        is your real account — not a bot. We watch your chats and messages so later you can start
        automation. Sending still happens as you.
      </p>
      <ol className="mt-6 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed">
        {needsAppKeys ? (
          <li>
            <span className="font-mono text-xs text-subtle">01</span>
            <p className="mt-1 text-fg">Register this desk as a Web app at my.telegram.org</p>
          </li>
        ) : null}
        <li>
          <span className="font-mono text-xs text-subtle">{needsAppKeys ? "02" : "01"}</span>
          <p className="mt-1 text-fg">Sign in with the phone on your Telegram</p>
        </li>
        <li>
          <span className="font-mono text-xs text-subtle">{needsAppKeys ? "03" : "02"}</span>
          <p className="mt-1 text-fg">Enter the login code Telegram sends you</p>
        </li>
      </ol>
      <div className="mt-8 grid gap-3">
        <Button type="button" size="lg" className="h-12 w-full justify-center text-base" onClick={onContinue}>
          Continue with my account
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
      </div>
      <p className="mt-4 text-xs leading-relaxed text-subtle">
        This desk shows up as a new device in Telegram. Revoke it anytime in Settings → Devices.
        Preview is local and is not your account.
      </p>
      {persistent ? null : (
        <p className="mt-4 rounded-xl border border-down/40 bg-down/10 p-3 text-sm leading-relaxed text-fg">
          This live site isn’t saving desks yet, so Telegram login codes will fail. Storage has to
          be connected first.
        </p>
      )}
    </>
  );
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-subtle">{label}</p>
          <p className="mt-1 break-all font-mono text-sm text-fg">{value}</p>
          {hint ? <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p> : null}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-fg"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function AppKeysStep({
  apiId,
  apiHash,
  onApiId,
  onApiHash,
  onBack,
  onContinue,
}: {
  apiId: string;
  apiHash: string;
  onApiId: (value: string) => void;
  onApiHash: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = appFormUrl(origin);
  const ready = apiId.trim().length >= 4 && apiHash.trim().length >= 16;
  const officialTitle = titleLooksOfficial(TELEGRAM_APP_FORM.title);

  return (
    <>
      <Back onClick={onBack} />
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Create the Web app.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Telegram requires every third-party desk to register its own numbers. Use the same phone as
        your Telegram. Type the values below exactly. Then paste the api_id and api_hash it gives
        you.
      </p>
      <button
        type="button"
        className="mt-4 inline-flex h-11 items-center justify-center rounded-md border border-border px-4 text-sm text-fg"
        onClick={() => {
          window.open(TELEGRAM_APP_FORM.toolsPath, "_blank", "noopener,noreferrer");
        }}
      >
        Open my.telegram.org/apps
      </button>
      <p className="mt-2 text-xs leading-relaxed text-subtle">
        Keep this tab. Telegram opens on another screen. When you come back, your values will still
        be here.
      </p>
      <ol className="mt-6 grid gap-2 text-sm leading-relaxed text-muted">
        <li>
          <span className="font-mono text-xs text-subtle">1</span>
          <p className="mt-1 text-fg">Log in with the phone already on Telegram.</p>
        </li>
        <li>
          <span className="font-mono text-xs text-subtle">2</span>
          <p className="mt-1 text-fg">Open API development tools → Create new application.</p>
        </li>
        <li>
          <span className="font-mono text-xs text-subtle">3</span>
          <p className="mt-1 text-fg">Fill the form with these values. Create application.</p>
        </li>
      </ol>
      <div className="mt-5 grid gap-2">
        <CopyRow label="App title" value={TELEGRAM_APP_FORM.title} hint="Do not type Telegram here." />
        <CopyRow
          label="Short name"
          value={TELEGRAM_APP_FORM.shortName}
          hint="5–32 letters and numbers. No spaces."
        />
        <CopyRow label="URL" value={url} />
        <CopyRow
          label="Platform"
          value={TELEGRAM_APP_FORM.platform}
          hint="Tap Web. Do not leave Android, iOS, or Desktop selected — that looks like a fake official app and can freeze the account."
        />
        <CopyRow label="Description" value={TELEGRAM_APP_FORM.description} />
      </div>
      <div className="mt-5 rounded-xl border border-down/40 bg-down/10 p-4 text-sm leading-relaxed">
        <p className="font-medium text-fg">Stay safe</p>
        <ul className="mt-2 grid gap-1.5 text-muted">
          <li>Platform must be Web. Android is the default and it is the wrong choice.</li>
          <li>Never copy api_id / api_hash from a friend, a blog, or Telegram Desktop.</li>
          <li>These numbers stay encrypted on this desk. They are not a bot token.</li>
          {officialTitle ? <li>Title must not be the word Telegram.</li> : null}
        </ul>
      </div>
      <form
        className="mt-6 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onContinue();
        }}
      >
        <p className="text-sm text-fg">After it creates, copy the two values it shows:</p>
        <Input
          value={apiId}
          onChange={(e) => onApiId(e.target.value)}
          placeholder="api_id  (a number)"
          autoComplete="off"
          inputMode="numeric"
          name="telegram-api-id"
          aria-label="API ID"
        />
        <Input
          value={apiHash}
          onChange={(e) => onApiHash(e.target.value)}
          placeholder="api_hash  (32 letters and numbers)"
          autoComplete="off"
          spellCheck={false}
          name="telegram-api-hash"
          aria-label="API hash"
        />
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full justify-center text-base"
          disabled={!ready}
        >
          I copied both — continue
        </Button>
      </form>
    </>
  );
}

function PhoneStep({
  needsAppKeys,
  apiId,
  apiHash,
  phone,
  onPhone,
  phoneHint,
  onBack,
  onSent,
}: {
  needsAppKeys: boolean;
  apiId: string;
  apiHash: string;
  phone: string;
  onPhone: (value: string) => void;
  phoneHint?: string | null;
  onBack: () => void;
  onSent: (status: TelegramStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const next = await telegramStartLoginFn({
        data: {
          phone,
          ...(needsAppKeys ? { apiId, apiHash } : {}),
        },
      });
      onSent(next);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setErr(
        msg === "Unauthorized"
          ? "This desk didn’t stay signed in. Open it again from the home screen — storage isn’t saving sessions yet."
          : msg || "Could not send a login code.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Back onClick={onBack} />
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Your phone number.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Same number as Telegram. We’ll send a login code there. This is you, not a bot.
      </p>
      {phoneHint ? (
        <p className="mt-3 font-mono text-xs text-subtle">Last used {phoneHint}</p>
      ) : null}
      <form
        className="mt-6 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
          placeholder="+1 555 123 4567"
          autoComplete="tel"
          inputMode="tel"
          name="telegram-phone"
          aria-label="Phone number"
        />
        {err ? (
          <p className="text-sm text-down" role="alert">
            {err}
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-subtle">Include the country code.</p>
        )}
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full justify-center text-base"
          disabled={busy || phone.trim().length < 8}
        >
          {busy ? "Sending code…" : "Send login code"}
        </Button>
      </form>
    </>
  );
}

function CodeStep({
  phoneHint,
  onBack,
  onStatus,
}: {
  phoneHint?: string | null;
  onBack: () => void;
  onStatus: (status: TelegramStatus) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      onStatus(await telegramSubmitCodeFn({ data: { code } }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "That code didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Back onClick={onBack} />
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Enter the code.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Telegram sent it {phoneHint ? `to ${phoneHint}` : "to your phone"}. Check the Telegram app
        or SMS.
      </p>
      <form
        className="mt-6 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder="12345"
          autoComplete="one-time-code"
          inputMode="numeric"
          name="telegram-code"
          aria-label="Login code"
        />
        {err ? (
          <p className="text-sm text-down" role="alert">
            {err}
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full justify-center text-base"
          disabled={busy || code.length < 4}
        >
          {busy ? "Checking…" : "Continue"}
        </Button>
      </form>
    </>
  );
}

function PasswordStep({
  onBack,
  onStatus,
}: {
  onBack: () => void;
  onStatus: (status: TelegramStatus) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      onStatus(await telegramSubmitPasswordFn({ data: { password } }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "That password didn’t match.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Back onClick={onBack} />
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Cloud password.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Two-step verification is on. Enter the password you set in Telegram. We never store it.
      </p>
      <form
        className="mt-6 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Cloud password"
          autoComplete="current-password"
          name="telegram-password"
          aria-label="Telegram cloud password"
        />
        {err ? (
          <p className="text-sm text-down" role="alert">
            {err}
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full justify-center text-base"
          disabled={busy || password.length < 1}
        >
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </>
  );
}

function ChecksStep({
  status,
  onBack,
  onStatus,
  onReady,
}: {
  status: TelegramStatus | null;
  onBack: () => void;
  onStatus: (status: TelegramStatus) => void;
  onReady: () => void;
}) {
  const watchChecks = useMemo(() => {
    const stored = status?.checks ?? [];
    return stored.length
      ? stored
      : TELEGRAM_CHECKS.map((c) => ({
          id: c.id,
          ok: null as boolean | null,
          detail: null as string | null,
          ranAt: null as string | null,
        }));
  }, [status]);

  const passed = requiredChecksPassed(watchChecks);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doneCount = watchChecks.filter((c) => {
    const meta = TELEGRAM_CHECKS.find((m) => m.id === c.id);
    return meta?.required && c.ok === true;
  }).length;
  const requiredTotal = TELEGRAM_CHECKS.filter((c) => c.required).length;

  async function runAll() {
    setBusy(true);
    setErr(null);
    try {
      onStatus(await telegramRunAllChecksFn());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not run checks.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setFinishing(true);
    setErr(null);
    try {
      await telegramFinishOnboardingFn();
      onReady();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not open the desk.");
      setFinishing(false);
    }
  }

  return (
    <>
      <Back onClick={onBack} />
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Confirm it’s you.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        We’ll list your chats, store recent messages, and turn watching on. OpenRouter is already
        wired — nothing is sent to it until you start automation later.
      </p>
      {status?.watch?.phoneHint ? (
        <p className="mt-3 font-mono text-xs text-subtle">{status.watch.phoneHint}</p>
      ) : null}
      <ul className="mt-6 grid gap-2">
        {TELEGRAM_CHECKS.map((meta) => {
          const row = watchChecks.find((c) => c.id === meta.id);
          const ok = row?.ok;
          return (
            <li
              key={meta.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 place-items-center rounded-full",
                  ok === true ? "bg-accent text-accent-fg" : "bg-surface-2 text-subtle",
                )}
              >
                {ok === true ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-fg">
                  {meta.title}
                  {meta.required ? null : (
                    <span className="ml-2 font-mono text-[10px] uppercase text-subtle">saved</span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                  {row?.detail || meta.blurb}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {err ? (
        <p className="mt-4 text-sm text-down" role="alert">
          {err}
        </p>
      ) : null}
      <div className="mt-6 grid gap-3">
        <Button
          type="button"
          size="lg"
          className="h-12 w-full justify-center text-base"
          disabled={busy || finishing}
          onClick={() => void runAll()}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" />
              Checking…
            </span>
          ) : (
            `Run checks${doneCount ? ` (${doneCount}/${requiredTotal})` : ""}`
          )}
        </Button>
        <Button
          type="button"
          variant={passed ? "default" : "secondary"}
          size="lg"
          className="h-12 w-full justify-center"
          disabled={!passed || finishing}
          onClick={() => void finish()}
        >
          {finishing ? "Opening desk…" : "Open my desk"}
        </Button>
      </div>
    </>
  );
}
