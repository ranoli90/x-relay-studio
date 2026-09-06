import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RedditAccountPublic } from "@/lib/reddit/types";
import { AppHeader } from "./app-header";
import { confirmOnboarding, runHealthCheck } from "@/lib/reddit/server";

const CONFIRM =
  "I confirm this is my Reddit account and authorize the displayed connection.";

export function HealthConfirm({
  account,
  onDone,
  onRefresh,
  embedded,
}: {
  account: RedditAccountPublic;
  onDone: () => void;
  onRefresh: (next: RedditAccountPublic) => void;
  embedded?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const health = account.health;
  const checks = health?.checks ?? [];
  const canEnter = Boolean(health?.okToUse);

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      const next = await runHealthCheck({ data: { accountId: account.id } });
      if (next) onRefresh(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Health check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmOnboarding({
        data: { accountId: account.id, phrase: CONFIRM },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-bg">
      {embedded ? null : <AppHeader />}
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
        Step 4 of 4 · Health
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        Last screen. Open the inbox when the session is honest.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Connected as <span className="text-fg">u/{account.name}</span>. Posting
        stays off for every account. Hard failures cannot be skipped.
      </p>

      {checks.length ? (
        <div className="mt-8 space-y-2">
          {checks.map((c) => (
            <div
              key={c.id}
              className="rounded-md border border-line bg-card px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{c.label}</p>
                <Status status={c.status} />
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{c.detail}</p>
              {c.fix ? (
                <p className="mt-1 text-xs leading-relaxed text-warn">{c.fix}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm leading-relaxed text-bad">{error}</p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1"
          type="button"
          disabled={busy || !canEnter}
          onClick={() => void confirm()}
        >
          Open inbox
        </Button>
        <Button
          className="flex-1"
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void rerun()}
        >
          Re-run checks
        </Button>
      </div>
    </section>
    </div>
  );
}

function Status({ status }: { status: string }) {
  const map: Record<string, string> = {
    pass: "text-ok",
    fail: "text-bad",
    warn: "text-warn",
    unknown: "text-warn",
  };
  return (
    <span className={`font-mono text-[11px] tracking-wider uppercase ${map[status] ?? "text-muted"}`}>
      {status}
    </span>
  );
}
