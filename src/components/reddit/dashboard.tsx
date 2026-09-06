import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { Plus, Shield } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UserButton } from "@/lib/auth/gates";
import type { RedditAccountPublic } from "@/lib/reddit/types";
import { disconnectAccount, runHealthCheck } from "@/lib/reddit/server";
import {
  loadRedditAccountActions,
  bindRedditRecoveryEmail,
  deleteRedditRecoveryEmail,
  generateRedditDraft,
  closeRedditBrowser,
  deleteRedditRetainedSignIn,
} from "@/lib/reddit/onboarding/server";
import type { AccountActionsSnapshot } from "@/lib/reddit/onboarding/account-actions";
import { Button } from "@/components/ui/button";
import { PushScreen } from "@/components/screen-stack";
import { OnboardingCoordinator } from "./onboarding/coordinator";
import { AccountActions } from "./onboarding/account-actions";
import { InboxView } from "./inbox-view";
import { cn } from "@/lib/utils";

export function Dashboard({
  accounts,
  onChanged,
}: {
  accounts: RedditAccountPublic[];
  onChanged: () => void;
}) {
  const ready = accounts.filter((a) => a.onboardedAt);
  const [activeId, setActiveId] = useState(ready[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [unread, setUnread] = useState(0);
  const [confirmCut, setConfirmCut] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [actions, setActions] = useState<AccountActionsSnapshot | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const account = ready.find((a) => a.id === activeId) ?? ready[0] ?? null;
  const onUnread = useCallback((n: number) => setUnread(n), []);

  const reloadActions = useCallback((accountId: string) => {
    void loadRedditAccountActions({ data: { accountId } })
      .then(setActions)
      .catch(() => setActions(null));
  }, []);

  const currentAccountId = account?.id;
  useEffect(() => {
    if (currentAccountId) reloadActions(currentAccountId);
  }, [currentAccountId, reloadActions]);

  const age = useMemo(() => {
    if (!account?.createdUtc) return "—";
    try {
      return formatDistanceToNowStrict(new Date(account.createdUtc * 1000));
    } catch {
      return "—";
    }
  }, [account?.createdUtc]);

  if (!account) {
    return (
      <div className="min-h-dvh bg-bg">
        <Topbar />
        <OnboardingCoordinator embedded onFinished={onChanged} />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-bg">
      <Topbar />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col md:flex-row">
        <aside className="border-b border-line md:w-64 md:border-r md:border-b-0">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
              Accounts
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>
          <ul>
            {ready.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(a.id);
                    setConfirmCut(false);
                    setHealthOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left",
                    a.id === account.id ? "bg-lift" : "hover:bg-lift/50",
                  )}
                >
                  <Avatar name={a.name} src={a.iconImg} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">u/{a.name}</span>
                    <span className="block font-mono text-[10px] tracking-wider text-subtle uppercase">
                      {a.healthOk ? "clear" : "watch"}
                    </span>
                  </span>
                  <span className={cn("size-1.5 rounded-full", a.healthOk ? "bg-ok" : "bg-warn")} />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <section className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-5">
            <Stat label="Post karma" value={fmt(account.linkKarma)} />
            <Stat label="Comment karma" value={fmt(account.commentKarma)} />
            <Stat label="Age" value={age} />
            <Stat label="Unread" value={String(unread)} />
            <Stat
              label="Standing"
              value={account.healthOk ? "Clear" : "Watch"}
              tone={account.healthOk ? "ok" : "warn"}
            />
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2">
            <p className="flex items-center gap-2 text-xs text-muted">
              <Shield className="size-3.5" />
              Read-only. Classic inbox only — Reddit Chat is not in this API.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setHealthOpen((v) => !v)}>
                Health
              </Button>
              {confirmCut ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void disconnectAccount({ data: { accountId: account.id } }).then(onChanged);
                    }}
                  >
                    Disconnect X Relay
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmCut(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmCut(true)}>
                  Disconnect X Relay
                </Button>
              )}
            </div>
          </div>
          {healthOpen ? (
            <div className="border-b border-line px-4 py-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-widest text-subtle">Last health</p>
                <Button
                  type="button"
                  variant="ghost" size="sm"
                  disabled={healthBusy}
                  onClick={() => {
                    setHealthBusy(true);
                    void runHealthCheck({ data: { accountId: account.id } })
                      .then(() => onChanged())
                      .finally(() => setHealthBusy(false));
                  }}
                >
                  {healthBusy ? "Checking…" : "Re-run"}
                </Button>
              </div>
              <ul className="space-y-2">
                {(account.health?.checks ?? []).map((c) => (
                  <li key={c.id} className="text-xs leading-relaxed">
                    <span className="font-medium">{c.label}</span>
                    <span className="mx-2 font-mono uppercase text-subtle">{c.status}</span>
                    <span className="text-muted">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <AccountActions
            accountId={account.id}
            accountName={account.name}
            readiness={actions?.readiness}
            bindings={actions?.emailBindings}
            profile={
              actions?.retainedProfile
                ? {
                    retentionRequested: actions.retainedProfile.retentionRequested,
                    retentionStatus: actions.retainedProfile.retentionStatus,
                    expiresAt: actions.retainedProfile.expiresAt,
                  }
                : null
            }
            draft={actions?.drafts[0] ?? null}
            busy={actionBusy}
            error={actionError}
            onReconnect={() => setAdding(true)}
            onCloseBrowser={() => {
              setActionBusy(true);
              setActionError(null);
              void closeRedditBrowser({ data: { accountId: account.id } })
                .then(() => reloadActions(account.id))
                .catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Could not close the browser."))
                .finally(() => setActionBusy(false));
            }}
            onDisconnectRelay={() => {
              void disconnectAccount({ data: { accountId: account.id } }).then(onChanged);
            }}
            onDeleteRetained={() => {
              setActionBusy(true);
              setActionError(null);
              void deleteRedditRetainedSignIn({ data: { accountId: account.id } })
                .then(() => reloadActions(account.id))
                .catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Could not delete retained sign-in."))
                .finally(() => setActionBusy(false));
            }}
            onCreateEmail={(input) => {
              setActionBusy(true);
              setActionError(null);
              void bindRedditRecoveryEmail({
                data: {
                  accountId: account.id,
                  address: input.address,
                  correlationId: crypto.randomUUID(),
                },
              })
                .then(() => reloadActions(account.id))
                .catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Could not save that address."))
                .finally(() => setActionBusy(false));
            }}
            onDeleteEmail={(bindingId) => {
              setActionBusy(true);
              setActionError(null);
              void deleteRedditRecoveryEmail({
                data: { accountId: account.id, bindingId, correlationId: crypto.randomUUID() },
              })
                .then(() => reloadActions(account.id))
                .catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Could not remove that address."))
                .finally(() => setActionBusy(false));
            }}
            onGenerateDraft={(input) => {
              setActionBusy(true);
              setActionError(null);
              void generateRedditDraft({
                data: {
                  accountId: account.id,
                  communityAllowlist: input.communityAllowlist,
                  topic: input.topic,
                  assertedFacts: input.assertedFacts,
                  selectedCommunity: input.selectedCommunity,
                  correlationId: crypto.randomUUID(),
                },
              })
                .then(() => reloadActions(account.id))
                .catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Could not generate a draft."))
                .finally(() => setActionBusy(false));
            }}
          />
          <InboxView accountId={account.id} onUnread={onUnread} />
        </main>
      </div>
      <PushScreen open={adding} className="bg-bg" z={20}>
        <div className="min-h-dvh overflow-y-auto bg-bg">
          <OnboardingCoordinator
            embedded
            onFinished={() => {
              setAdding(false);
              onChanged();
            }}
          />
          <div className="mx-auto max-w-xl px-5 pb-12">
            <Button variant="ghost" type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </PushScreen>
    </div>
  );
}

function Topbar() {
  return (
    <header className="flex items-center justify-between border-b border-line px-4 py-3">
      <div>
        <p className="font-mono text-[11px] tracking-[0.2em] text-muted uppercase">Reddit</p>
        <Link to="/" className="text-xs text-subtle hover:text-fg">
          All platforms
        </Link>
      </div>
      <UserButton />
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="bg-bg px-4 py-3">
      <p className="font-mono text-[10px] tracking-[0.16em] text-subtle uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-lg tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="size-8 rounded-full bg-lift object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className="grid size-8 place-items-center rounded-full bg-lift font-mono text-xs text-muted">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(n);
}
