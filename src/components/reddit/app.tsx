import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getBootstrap } from "@/lib/reddit/server";
import type { RedditAccountPublic, RedditAppPublic } from "@/lib/reddit/types";
import { AddAccount } from "./add-account";
import { Dashboard } from "./dashboard";
import { HealthConfirm } from "./health-confirm";
import { SetupApp } from "./setup-app";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";

export function RedditApp() {
  const [loading, setLoading] = useState(true);
  const [app, setApp] = useState<RedditAppPublic | null>(null);
  const [accounts, setAccounts] = useState<RedditAccountPublic[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [addingFirst, setAddingFirst] = useState(false);

  const reload = useCallback(async () => {
    const boot = await getBootstrap();
    setApp(boot.app);
    setAccounts(boot.accounts);
    setPendingId(boot.pendingAccountId);
    setAddingFirst(boot.app.configured && boot.accounts.length === 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload().catch(() => setLoading(false));
  }, [reload]);

  if (loading || !app) {
    return (
      <div className="min-h-dvh bg-bg px-5 py-10">
        <Logo />
        <Skeleton className="mt-8 h-8 w-48" />
        <Skeleton className="mt-4 h-28 w-full max-w-xl" />
      </div>
    );
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
