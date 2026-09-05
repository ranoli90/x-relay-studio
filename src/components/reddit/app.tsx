import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBootstrap } from "@/lib/reddit/server";
import type { RedditAccountPublic, RedditAppPublic } from "@/lib/reddit/types";
import { AddAccount } from "./add-account";
import { Dashboard } from "./dashboard";
import { HealthConfirm } from "./health-confirm";
import { SetupApp } from "./setup-app";
import { DoorSkeleton } from "@/components/screen-stack";
import { OnboardingCoordinator } from "./onboarding/coordinator";
import { getOnboardingBootstrap } from "@/lib/reddit/onboarding/server";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

type BootCache = {
  userId: string;
  app: RedditAppPublic;
  accounts: RedditAccountPublic[];
  pendingId: string | null;
  addingFirst: boolean;
};

const bootByUser = new Map<string, BootCache>();

export function RedditApp() {
  const { user } = useCurrentUserState();
  const userId = user?.id ?? "signed-out";
  const cached = bootByUser.get(userId) ?? null;
  const [loading, setLoading] = useState(!cached);
  const [app, setApp] = useState<RedditAppPublic | null>(cached?.app ?? null);
  const [accounts, setAccounts] = useState<RedditAccountPublic[]>(cached?.accounts ?? []);
  const [pendingId, setPendingId] = useState<string | null>(cached?.pendingId ?? null);
  const [addingFirst, setAddingFirst] = useState(cached?.addingFirst ?? false);
  const [onboardingOn, setOnboardingOn] = useState(true);
  const lastUser = useRef(userId);

  const reload = useCallback(async () => {
    const [boot, onboarding] = await Promise.all([getBootstrap(), getOnboardingBootstrap()]);
    const addingFirstNext = boot.app.configured && boot.accounts.length === 0;
    const next: BootCache = {
      userId,
      app: boot.app,
      accounts: boot.accounts,
      pendingId: boot.pendingAccountId,
      addingFirst: addingFirstNext,
    };
    bootByUser.clear();
    bootByUser.set(userId, next);
    setApp(boot.app);
    setAccounts(boot.accounts);
    setPendingId(boot.pendingAccountId);
    setAddingFirst(addingFirstNext);
    setOnboardingOn(onboarding.onboardingEnabled);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (lastUser.current !== userId) {
      bootByUser.delete(lastUser.current);
      lastUser.current = userId;
      setApp(null);
      setAccounts([]);
      setPendingId(null);
      setLoading(true);
    }
    void reload().catch(() => setLoading(false));
  }, [reload, userId]);

  if (loading || !app) {
    return <DoorSkeleton />;
  }

  if (onboardingOn && (!app.configured || addingFirst || accounts.every((a) => !a.onboardedAt))) {
    return <OnboardingCoordinator onFinished={() => void reload()} />;
  }

  if (!app.configured) return <SetupApp onSaved={() => void reload()} />;

  if (!onboardingOn) {
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
