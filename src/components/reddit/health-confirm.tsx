import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RedditAccountPublic } from "@/lib/reddit/types";
import { AppHeader } from "./app-header";
import { confirmOnboarding, runHealthCheck } from "@/lib/reddit/server";

export function HealthConfirm({
  account,
  onDone,
  onRefresh,
}: {
  account: RedditAccountPublic;
  onDone: () => void;
  onRefresh: (next: RedditAccountPublic) => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [checks, setChecks] = useState({
    mine: false,
    email: false,
    noBanEvasion: false,
    readOnly: false,
    privateWindow: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const health = account.health;
  const hard = health?.checks.filter((c) => c.severity === "hard") ?? [];
  const rest = health?.checks.filter((c) => c.severity !== "hard") ?? [];

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
        data: { accountId: account.id, phrase },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  }

  const visibility = health?.checks.find((c) => c.id === "visible");
  const needsPrivateWindow =
    visibility?.status === "unknown" || visibility?.status === "fail";
  const ticked =
    checks.mine &&
    checks.email &&
    checks.noBanEvasion &&
    checks.readOnly &&
    (!needsPrivateWindow || checks.privateWindow);
  const canEnter = Boolean(health?.okToUse) && ticked;

  return (
    <div className="min-h-dvh bg-bg">
      <AppHeader />
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">
        Step 4 of 4 · Health
      </p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">
        Last screen. We will not open the inbox until this is honest.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Connected as <span className="text-fg">u/{account.name}</span>. Posting
        stays off for every account. Hard failures cannot be skipped.
      </p>

      <div className="mt-8 space-y-2">
        {[...hard, ...rest].map((c) => (
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

      <div className="mt-8 space-y-3 text-sm">
        <Tick
          checked={checks.mine}
          onChange={(v) => setChecks({ ...checks, mine: v })}
          label="This is my Reddit account, not someone else’s."
        />
        <Tick
          checked={checks.email}
          onChange={(v) => setChecks({ ...checks, email: v })}
          label="I verified email on reddit.com/settings/account, or I will before I ever post."
        />
        <Tick
          checked={checks.noBanEvasion}
          onChange={(v) => setChecks({ ...checks, noBanEvasion: v })}
          label="I am not using this account to get around a ban."
        />
        <Tick
          checked={checks.readOnly}
          onChange={(v) => setChecks({ ...checks, readOnly: v })}
          label="I understand this inbox cannot post, vote, or message people for me."
        />
        {needsPrivateWindow ? (
          <Tick
            checked={checks.privateWindow}
            onChange={(v) => setChecks({ ...checks, privateWindow: v })}
            label={`I opened reddit.com/user/${account.name} in a private window and the profile loaded.`}
          />
        ) : null}
      </div>

      <label className="mt-6 block">
        <span className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
          Type this exactly
        </span>
        <input
          className="mt-2 h-11 w-full rounded-md border border-line bg-lift px-3 font-mono text-sm text-fg outline-none placeholder:text-subtle focus:border-muted"
          value={phrase}
          placeholder="I WILL NOT POST YET"
          onChange={(e) => setPhrase(e.target.value)}
        />
      </label>

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

function Tick({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 size-4 accent-accent"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-muted">{label}</span>
    </label>
  );
}
