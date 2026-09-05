import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppHeader } from "./app-header";
import { startRedditOAuth } from "@/lib/reddit/server";

type StartResult = { start: string; correlationId?: string };

export function AddAccount({
  onConnected,
  additional,
  expectedUsername,
  onStart,
}: {
  onConnected: () => void;
  additional?: boolean;
  expectedUsername?: string | null;
  onStart?: () => Promise<StartResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const correlationRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (popupRef.current && ev.source && ev.source !== popupRef.current) return;
      const data = ev.data as { type?: string; ok?: boolean; error?: string; correlationId?: string };
      if (data?.type !== "reddit-oauth") return;
      if (correlationRef.current && data.correlationId && data.correlationId !== correlationRef.current) return;
      if (data.ok) onConnected();
      else setError(data.error === "denied" ? "You cancelled on Reddit." : data.error || "Connect failed.");
      setBusy(false);
      stopWatching();
    }
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("message", onMsg);
      stopWatching();
    };
  }, [onConnected]);

  function stopWatching() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function connect() {
    setError(null);
    const popup = window.open("about:blank", "reddit-oauth", "width=520,height=720");
    popupRef.current = popup;
    setBusy(true);
    try {
      const started = onStart
        ? await onStart()
        : await startRedditOAuth({ data: { origin: window.location.origin } });
      correlationRef.current = started.correlationId ?? null;
      if (!popup) {
        window.location.assign(started.start);
        return;
      }
      popup.location.assign(started.start);
      const openedAt = Date.now();
      stopWatching();
      timerRef.current = setInterval(() => {
        if (popup.closed) {
          stopWatching();
          setBusy(false);
          setError("The Reddit window closed before finishing. You can try again, or continue in this tab.");
        } else if (Date.now() - openedAt > 10 * 60 * 1000) {
          stopWatching();
          setBusy(false);
          setError("This Reddit login timed out. Try again.");
        }
      }, 500);
    } catch (e) {
      setBusy(false);
      if (popup && !popup.closed) popup.close();
      setError(e instanceof Error ? e.message : "Could not start Reddit login.");
    }
  }

  return (
    <div className="min-h-dvh bg-bg">
      {additional ? null : <AppHeader />}
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
        {additional ? "Add account" : "Connect"}
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        {expectedUsername
          ? `Connect u/${expectedUsername}`
          : additional
            ? "Add another Reddit account the same way."
            : "Allow with the account you want to connect."}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        {expectedUsername
          ? `Sign in the account u/${expectedUsername}. A different logged-in account will not be attached.`
          : additional
            ? "Allow with the next account. The developer account that owns the app can be different."
            : "A popup opens Reddit’s Allow screen. Sign in the account you intend to connect."}
      </p>
      <ul className="mt-6 space-y-2 text-sm text-muted">
        <li>X Relay uses this connection to read identity, the classic inbox, and account health.</li>
        <li>The token includes Reddit’s privatemessages scope, which Reddit also associates with composing mail. X Relay does not send messages, posts, or votes.</li>
        <li>Regular public subreddits only. You are not a moderator here.</li>
      </ul>
      {error ? (
        <p className="mt-4 text-sm leading-relaxed text-bad">{error}</p>
      ) : null}
      <Button className="mt-8 w-full" type="button" disabled={busy} onClick={() => void connect()}>
        {busy ? "Waiting on Reddit…" : "Continue with Reddit"}
      </Button>
      {busy ? (
        <Button
          className="mt-3 w-full"
          type="button"
          variant="ghost"
          onClick={() => {
            stopWatching();
            setBusy(false);
            const start = popupRef.current;
            if (start && !start.closed) start.close();
          }}
        >
          Retry
        </Button>
      ) : null}
    </section>
    </div>
  );
}
