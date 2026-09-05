import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "./app-header";
import { CopyRow } from "./copy-row";
import { getRedirectUri, saveRedditApp } from "@/lib/reddit/server";

export function SetupApp({ onSaved }: { onSaved: () => void }) {
  const [redirectUri, setRedirectUri] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [userAgentName, setUserAgentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const origin = window.location.origin;
    void getRedirectUri({ data: { origin } }).then((r) =>
      setRedirectUri(r.redirectUri),
    );
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveRedditApp({
        data: {
          clientId,
          clientSecret,
          userAgentName,
          origin: window.location.origin,
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
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
        Step 1 of 3 · Reddit app
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        Create the app once. Every account after this is just Allow.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Do this while logged into the Reddit account that will own the developer
        app. Type the fields below exactly. Then paste the two values Reddit
        shows you. We test the credentials against Reddit before saving — if
        they are wrong, we stop.
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
            <span className="font-mono text-fg">create an app...</span> or{" "}
            <span className="font-mono text-fg">create another app...</span>
          </p>
        </li>
        <li className="space-y-3">
          <p className="font-medium">2. Fill the form with these exact values</p>
          <CopyRow label="name" value="Reddit Relay" />
          <CopyRow
            label="app type"
            value="web app"
            hint="Click the web app radio. Do not click installed app. Do not click script."
          />
          <CopyRow
            label="description"
            value="Sign in the Reddit account you’ll use in Reddit Relay. Inbox and health only. Not an official Reddit client."
          />
          <CopyRow
            label="redirect uri"
            value={redirectUri || "Loading this page’s address…"}
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
          label="Reddit username that created the app"
          value={userAgentName}
          onChange={setUserAgentName}
          placeholder="without u/"
        />
        <Field
          label="client id"
          value={clientId}
          onChange={setClientId}
          placeholder="string under the app name"
          mono
        />
        <Field
          label="secret"
          value={clientSecret}
          onChange={setClientSecret}
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
        disabled={busy || !redirectUri}
        onClick={() => void save()}
      >
        {busy ? "Testing with Reddit…" : "Test credentials and continue"}
      </Button>
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        We send a client-credentials request only. No account is connected yet.
        Posting permission is not requested.
      </p>
    </section>
    </div>
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
