import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SteelHostPublic } from "@/lib/reddit/onboarding/types";

export function SteelHostCard({
  host,
  busy,
  error,
  onSave,
  onDisconnect,
}: {
  host: SteelHostPublic;
  busy?: boolean;
  error?: string | null;
  onSave: (apiKey: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function connect() {
    setLocalError(null);
    try {
      await onSave(key);
      setKey("");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not connect Steel.");
    }
  }

  return (
    <section className="mx-auto w-full max-w-xl px-5 pb-10">
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Free hosted browser</p>
        <h2 className="mt-2 text-lg font-medium tracking-tight">Steel Cloud</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Steel hosts the remote browser. The free plan needs no card — about 300 browser hours.
          Register, copy an API key, and paste it here. CAPTCHA, terms, and final submit stay your
          clicks.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {host.previewUsesLocal
            ? "This practice preview still uses the local browser, so live Reddit is not opened here. After you paste a key, hosted setup can use Steel."
            : "Saved keys stay encrypted on this desk. They are never shown again."}
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <a className="text-accent underline-offset-4 hover:underline" href={host.signupUrl} target="_blank" rel="noreferrer">
            Create a free Steel account
          </a>
          <a className="text-accent underline-offset-4 hover:underline" href={host.keysUrl} target="_blank" rel="noreferrer">
            Open API keys
          </a>
        </div>

        {host.connected ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg">
              Connected {host.hint ? <span className="font-mono text-muted">{host.hint}</span> : null}
            </p>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onDisconnect()}>
              Disconnect
            </Button>
          </div>
        ) : (
          <form
            className="mt-4 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <label className="text-xs uppercase tracking-widest text-muted" htmlFor="steel-api-key">
              Steel API key
            </label>
            <Input
              id="steel-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste the key from Steel → Settings → API keys"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              disabled={busy}
            />
            <Button type="submit" disabled={busy || key.trim().length < 16}>
              {busy ? "Checking…" : "Connect Steel"}
            </Button>
          </form>
        )}
        {localError || error ? <p className="mt-2 text-sm text-bad">{localError || error}</p> : null}
      </div>
    </section>
  );
}
