import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "./app-header";
import { CopyRow } from "./copy-row";
import { getSetupCopy, saveRedditApp } from "@/lib/reddit/server";

const TERMS = [
  {
    label: "Read the full API terms and sign up for usage (wiki)",
    href: "https://www.reddit.com/r/reddit.com/wiki/api/#wiki_read_the_full_api_terms_and_sign_up_for_usage",
  },
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
const POLICY =
  "https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy";
const REGISTER_APPS = "https://developers.reddit.com/app-registration";
const PREFS = "https://www.reddit.com/prefs/apps";

export function SetupApp({ onSaved }: { onSaved: () => void }) {
  const [copy, setCopy] = useState<{
    appLabel: string;
    appId: string;
    description: string;
    signupBlurb: string;
    redirectUri: string;
  } | null>(null);
  const [stage, setStage] = useState<"terms" | "app">("terms");
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
          acceptedTerms: true,
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
            error={error}
            onNext={() => {
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
  error,
  onNext,
}: {
  copy: {
    appLabel: string;
    signupBlurb: string;
  } | null;
  error: string | null;
  onNext: () => void;
}) {
  return (
    <>
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
        Step 1 of 4 · Data API
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        Flip Reddit’s access flag before you create the app.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        There is no Accept button on prefs/apps. Creating the first app is
        locked until Reddit records this request. Submitting the form is not
        Reddit’s approval of this use case — it only asks them to unlock app
        creation. The switch is two dropdowns on their form, word for word from{" "}
        <a
          className="text-fg underline decoration-line underline-offset-4"
          href="https://www.reddit.com/r/reddit.com/wiki/api/"
          target="_blank"
          rel="noreferrer"
        >
          reddit.com/wiki/api
        </a>
        .
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
          <p className="font-medium">2. Open this form. These two slots flip the flag.</p>
          <p className="text-muted">
            Logged in as the <span className="text-fg">developer account</span>,
            open{" "}
            <a
              className="text-fg underline decoration-line underline-offset-4"
              href={FORM}
              target="_blank"
              rel="noreferrer"
            >
              the Data API request
            </a>
            . That is ticket form 14868593862164. Not Devvit. Not Ads.
          </p>
          <CopyRow
            label="First dropdown — pick exactly"
            value="I'm a Developer"
            hint="Not a moderator ticket. Not researcher. Not enterprise."
          />
          <CopyRow
            label="Second dropdown — pick exactly"
            value="I want to register to use the Reddit API."
            hint="Including the period. This is the line Reddit’s wiki tells you to select."
          />
          <CopyRow
            label="App name on the form"
            value={copy?.appLabel || "Loading this desk’s name…"}
            hint="Do not type Reddit or Snoo in the name."
          />
          <CopyRow
            label="Paste this as the use case / description"
            value={copy?.signupBlurb || "Loading…"}
          />
          <div className="rounded-md border border-line bg-lift p-4 text-xs leading-relaxed text-muted">
            <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
              How you know the flag flipped
            </p>
            <p className="mt-2">
              Submit once. Do not open a second ticket for the same use. Wait
              for Reddit’s reply.
            </p>
            <p className="mt-2">
              Then open{" "}
              <a
                className="text-fg underline decoration-line underline-offset-4"
                href={PREFS}
                target="_blank"
                rel="noreferrer"
              >
                reddit.com/prefs/apps
              </a>
              . If create app still says{" "}
              <span className="text-fg">
                In order to create an application or use our API you can read
                our full policies here
              </span>{" "}
              and links{" "}
              <a
                className="text-fg underline decoration-line underline-offset-4"
                href={POLICY}
                target="_blank"
                rel="noreferrer"
              >
                the Responsible Builder Policy
              </a>
              , the flag is still off. Stop. Do not keep hitting create app.
            </p>
            <p className="mt-2">
              Unlocked looks like: create an app works, then a client id appears. Creating the
              app is how you agree to the Developer Terms and Data API Terms — there is no extra
              Accept button.
            </p>
            <p className="mt-2">
              Developer account fills this form and owns prefs/apps. The
              warmed-up account is Allowed later. Do not submit as the bot.
            </p>
          </div>
        </li>
      </ol>

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
        Stay logged into the same developer account. Copy the name exactly — it
        is unique to this desk. Creating the app is Reddit’s terms agreement
        (“By creating an app, you agree to Reddit’s Developer Terms and Data
        API Terms”). There is no extra Accept button.
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
            secret. If Reddit shows the policy page instead, the flag is still
            off — go back.
          </p>
        </li>
        <li>
          <p className="font-medium">4. Register the app label (after it exists)</p>
          <p className="mt-1 text-muted">
            Reddit also wants existing Data API apps labeled. Open{" "}
            <a
              className="text-fg underline decoration-line underline-offset-4"
              href={REGISTER_APPS}
              target="_blank"
              rel="noreferrer"
            >
              developers.reddit.com/app-registration
            </a>
            , click <span className="font-mono text-fg">Log in to Start Registration</span>,
            and register this app from the same developer account.
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
