import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getBootstrap } from "@/lib/reddit/server";
import type { RedditAccountPublic, RedditAppPublic } from "@/lib/reddit/types";
import { AddAccount } from "./add-account";
import { Dashboard } from "./dashboard";
import { HealthConfirm } from "./health-confirm";
import { SetupApp } from "./setup-app";
import { DoorSkeleton } from "@/components/screen-stack";

type BootCache = {
  app: RedditAppPublic;
  accounts: RedditAccountPublic[];
  pendingId: string | null;
  addingFirst: boolean;
};

let bootCache: BootCache | null = null;

export function RedditApp() {
  const [loading, setLoading] = useState(!bootCache);
  const [app, setApp] = useState<RedditAppPublic | null>(bootCache?.app ?? null);
  const [accounts, setAccounts] = useState<RedditAccountPublic[]>(bootCache?.accounts ?? []);
  const [pendingId, setPendingId] = useState<string | null>(bootCache?.pendingId ?? null);
  const [addingFirst, setAddingFirst] = useState(bootCache?.addingFirst ?? false);

  const reload = useCallback(async () => {
    const boot = await getBootstrap();
    const addingFirstNext = boot.app.configured && boot.accounts.length === 0;
    bootCache = {
      app: boot.app,
      accounts: boot.accounts,
      pendingId: boot.pendingAccountId,
      addingFirst: addingFirstNext,
    };
    setApp(boot.app);
    setAccounts(boot.accounts);
    setPendingId(boot.pendingAccountId);
    setAddingFirst(addingFirstNext);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload().catch(() => setLoading(false));
  }, [reload]);

  if (loading || !app) {
    return <DoorSkeleton />;
  }

  if (!app.configured) return <SetupApp onSaved={() => void reload()} />;

  const pending = accounts.find((a) => a.id === pendingId && !a.onboardedAt);
  if (pending) {
    return (
      <HealthConfirm
        account={pending}
        onDone={() => void reload()}
        onRefresh={(next) =>
          setAccounts((prev) => prev.map((a) => (a.id === next.id ? next : a)))
        }
      />
    );
  }

  if (addingFirst || accounts.every((a) => !a.onboardedAt)) {
    return <AddAccount onConnected={() => void reload()} />;
  }

  return <Dashboard accounts={accounts} onChanged={() => void reload()} />;
}

export function PlatformsLink() {
  return (
    <Link
      to="/"
      className="text-xs text-subtle transition-colors duration-[var(--motion-quick)] hover:text-fg"
    >
      All platforms
    </Link>
  );
}
