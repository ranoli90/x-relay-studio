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
        {additional ? "Add account" : "Step 3 of 4 · Allow"}
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        {additional
          ? "Add another Reddit account the same way."
          : "Allow with the warmed-up bot. Not the developer."}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        {additional
          ? "Allow with the next warmed-up account. Not the developer account that owns the app."
          : "A popup opens Reddit’s Allow screen. Sign in the warmed-up bot account — not the developer account you used for the Data API form and prefs/apps."}
      </p>
      <ul className="mt-6 space-y-2 text-sm text-muted">
        <li>Bot account ≠ developer account.</li>
        <li>Use the warmed-up account you will actually post from later.</li>
        <li>Regular public subreddits only. You are not a moderator here.</li>
        <li>Permissions: identity, inbox, and read only. No post, vote, or send.</li>
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
