import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "./app-header";
import { startRedditOAuth } from "@/lib/reddit/server";

export function AddAccount({
  onConnected,
  additional,
}: {
  onConnected: () => void;
  additional?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; ok?: boolean; error?: string };
      if (data?.type !== "reddit-oauth") return;
      if (data.ok) onConnected();
      else setError(data.error === "denied" ? "You cancelled on Reddit." : data.error || "Connect failed.");
      setBusy(false);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onConnected]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { start } = await startRedditOAuth({
        data: { origin: window.location.origin },
      });
      const popup = window.open(
        start,
        "reddit-oauth",
        "width=520,height=720",
      );
      if (!popup) {
        window.location.assign(start);
      }
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not start Reddit login.");
    }
  }

  return (
    <div className="min-h-dvh bg-bg">
      {additional ? null : <AppHeader />}
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
        {additional ? "Add account" : "Step 2 of 3 · Allow"}
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        {additional
          ? "Add another Reddit account the same way."
          : "Sign in the Reddit account you’ll use here."}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Reddit confirms. We never see your password. A popup opens Reddit’s
        Allow screen. Use the account you want in the inbox — you can add a
        second, third, and fourth the same way after this.
      </p>
      <ul className="mt-6 space-y-2 text-sm text-muted">
        <li>Permissions: identity, inbox, and read only.</li>
        <li>Not requested: post, comment, vote, or send mail in bulk.</li>
        <li>Revoke anytime at reddit.com/prefs/apps → authorized applications.</li>
      </ul>
      {error ? (
        <p className="mt-4 text-sm leading-relaxed text-bad">{error}</p>
      ) : null}
      <Button className="mt-8 w-full" type="button" disabled={busy} onClick={() => void connect()}>
        {busy ? "Waiting on Reddit…" : "Continue with Reddit"}
      </Button>
    </section>
    </div>
  );
}
