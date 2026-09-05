import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "./app-header";
import { CopyRow } from "./copy-row";
import { getSetupCopy, saveRedditApp } from "@/lib/reddit/server";

const TERMS = [
  {
    label: "Developer Terms",
    href: "https://www.redditinc.com/policies/developer-terms",
  },
  {
    label: "Data API Terms",
    href: "https://www.redditinc.com/policies/data-api-terms",
  },
  {
    label: "Responsible Builder Policy",
    href: "https://support.reddithelp.com/hc/articles/42728983564564",
  },
  {
    label: "Data API wiki",
    href: "https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki",
  },
] as const;

const FORM =
  "https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164";

export function SetupApp({ onSaved }: { onSaved: () => void }) {
  const [copy, setCopy] = useState<{
    appLabel: string;
    appId: string;
    description: string;
    signupBlurb: string;
    redirectUri: string;
  } | null>(null);
  const [stage, setStage] = useState<"terms" | "app">("terms");
  const [read, setRead] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [userAgentName, setUserAgentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSetupCopy({ data: { origin: window.location.origin } })
      .then(setCopy)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Could not load this desk’s app name."),
      );
  }, []);

  async function save() {
    if (!copy) return;
    setBusy(true);
    setError(null);
    try {
      await saveRedditApp({
        data: {
          clientId,
          clientSecret,
          userAgentName,
          origin: window.location.origin,
          acceptedTerms: read && submitted,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the app.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-bg">
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
        {stage === "terms" ? (
          <Terms
            copy={copy}
            read={read}
            submitted={submitted}
            error={error}
            onRead={setRead}
            onSubmitted={setSubmitted}
            onNext={() => {
              if (!read || !submitted) {
                setError("Read the terms and submit the Data API form before creating the app.");
                return;
              }
              setError(null);
              setStage("app");
            }}
          />
        ) : (
          <CreateApp
            copy={copy}
            clientId={clientId}
            clientSecret={clientSecret}
            userAgentName={userAgentName}
            error={error}
            busy={busy}
            onClientId={setClientId}
            onSecret={setClientSecret}
            onUser={setUserAgentName}
            onBack={() => setStage("terms")}
            onSave={() => void save()}
          />
        )}
      </section>
    </div>
  );
}

function Terms({
  copy,
  read,
  submitted,
  error,
  onRead,
  onSubmitted,
  onNext,
}: {
  copy: {
    appLabel: string;
    signupBlurb: string;
  } | null;
  read: boolean;
  submitted: boolean;
  error: string | null;
  onRead: (v: boolean) => void;
  onSubmitted: (v: boolean) => void;
  onNext: () => void;
}) {
  return (
    <>
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
        Step 1 of 4 · Data API
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        Sign up for Reddit’s Data API before you create the app.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Reddit requires this. Do it while logged into the{" "}
        <span className="text-fg">developer account</span> — the one that will
        own prefs/apps. That is not the bot. The warmed-up account comes later,
        on Allow.
      </p>

      <ol className="mt-8 space-y-6 text-sm leading-relaxed">
        <li>
          <p className="font-medium">1. Read these, in order</p>
          <ul className="mt-2 space-y-2 text-muted">
            {TERMS.map((t) => (
              <li key={t.href}>
                <a
                  className="text-fg underline decoration-line underline-offset-4"
                  href={t.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </li>
        <li className="space-y-3">
          <p className="font-medium">2. Open the Data API request</p>
          <p className="text-muted">
            Logged in as the developer account, open{" "}
            <a
              className="text-fg underline decoration-line underline-offset-4"
              href={FORM}
              target="_blank"
              rel="noreferrer"
            >
              Reddit’s Data API signup form
            </a>
            . If it asks commercial vs non-commercial, pick{" "}
            <span className="font-mono text-fg">non-commercial</span>.
          </p>
          <CopyRow
            label="App name on the form"
            value={copy?.appLabel || "Loading this desk’s name…"}
            hint="Do not type Reddit or Snoo in the name. Reddit forbids that."
          />
          <CopyRow
            label="Paste this as the use case"
            value={copy?.signupBlurb || "Loading…"}
          />
          <div className="rounded-md border border-line bg-lift p-4 text-xs leading-relaxed text-muted">
            <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
              Accounts
            </p>
            <p className="mt-2">
              Developer account (this form + prefs/apps) ≠ the bot. The bot is
              your warmed-up account. You Allow that one in a later step. Do not
              submit this form as the bot.
            </p>
            <p className="mt-2">
              You are not a moderator here. Regular public subreddits only, as a
              normal user, when posting exists. Not a mod tool.
            </p>
          </div>
        </li>
      </ol>

      <label className="mt-8 flex cursor-pointer items-start gap-3 text-sm text-muted">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-fg"
          checked={read}
          onChange={(e) => onRead(e.target.checked)}
        />
        I read the Developer Terms, Data API Terms, and Responsible Builder Policy.
      </label>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-muted">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-fg"
          checked={submitted}
          onChange={(e) => onSubmitted(e.target.checked)}
        />
        I submitted the Data API request from the developer account, not the bot.
      </label>
      {error ? <p className="mt-4 text-sm leading-relaxed text-bad">{error}</p> : null}
      <Button className="mt-8 w-full" type="button" disabled={!copy} onClick={onNext}>
        Continue to create app
      </Button>
    </>
  );
}

function CreateApp({
  copy,
  clientId,
  clientSecret,
  userAgentName,
  error,
  busy,
  onClientId,
  onSecret,
  onUser,
  onBack,
  onSave,
}: {
  copy: {
    appLabel: string;
    description: string;
    redirectUri: string;
  } | null;
  clientId: string;
  clientSecret: string;
  userAgentName: string;
  error: string | null;
  busy: boolean;
  onClientId: (v: string) => void;
  onSecret: (v: string) => void;
  onUser: (v: string) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
        Step 2 of 4 · Create the app
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        Create the app on the developer account. Unique name. No “Reddit”.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Stay logged into the same developer account you used on the Data API
        form. Copy the name exactly — it is unique to this desk.
      </p>

      <ol className="mt-8 space-y-6 text-sm leading-relaxed">
        <li>
          <p className="font-medium">1. Open Reddit apps</p>
          <p className="mt-1 text-muted">
            Go to{" "}
            <a
              className="text-fg underline decoration-line underline-offset-4"
              href="https://www.reddit.com/prefs/apps"
              target="_blank"
              rel="noreferrer"
            >
              reddit.com/prefs/apps
            </a>
            . Scroll to the bottom. Click{" "}
            <span className="font-mono text-fg">create an app...</span>
          </p>
        </li>
        <li className="space-y-3">
          <p className="font-medium">2. Fill the form with these exact values</p>
          <CopyRow
            label="name"
            value={copy?.appLabel || "Loading…"}
            hint="Must not contain Reddit or Snoo."
          />
          <CopyRow
            label="app type"
            value="web app"
            hint="Click the web app radio. Do not click installed app. Do not click script."
          />
          <CopyRow label="description" value={copy?.description || "Loading…"} />
          <p className="rounded-md border border-line bg-lift p-4 text-xs leading-relaxed text-muted">
            <span className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
              about url
            </span>
            <span className="mt-2 block">Leave this field empty on Reddit.</span>
          </p>
          <CopyRow
            label="redirect uri"
            value={copy?.redirectUri || "Loading this page’s address…"}
            hint="This must match character for character. Extra slash = Reddit 403."
          />
        </li>
        <li>
          <p className="font-medium">3. Click create app, then paste</p>
          <p className="mt-1 text-muted">
            Client id is the short string under the app name. Secret is labeled
            secret.
          </p>
        </li>
      </ol>

      <div className="mt-8 space-y-3">
        <Field
          label="Developer username (created the app)"
          value={userAgentName}
          onChange={onUser}
          placeholder="without u/"
        />
        <Field
          label="client id"
          value={clientId}
          onChange={onClientId}
          placeholder="string under the app name"
          mono
        />
        <Field
          label="secret"
          value={clientSecret}
          onChange={onSecret}
          placeholder="labeled secret"
          mono
          password
        />
      </div>

      {error ? (
        <p className="mt-4 text-sm leading-relaxed text-bad">{error}</p>
      ) : null}

      <Button
        className="mt-6 w-full"
        type="button"
        disabled={busy || !copy}
        onClick={onSave}
      >
        {busy ? "Testing with Reddit…" : "Test credentials and continue"}
      </Button>
      <button
        type="button"
        className="mt-4 w-full text-center text-xs text-subtle"
        onClick={onBack}
      >
        Back to Data API
      </button>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  password,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  password?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
        {label}
      </span>
      <input
        className={`mt-2 h-11 w-full rounded-md border border-line bg-lift px-3 text-sm text-fg outline-none placeholder:text-subtle focus:border-muted ${mono ? "font-mono" : ""}`}
        value={value}
        placeholder={placeholder}
        type={password ? "password" : "text"}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
