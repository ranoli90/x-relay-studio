import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TelegramLoginScreen } from "@/components/telegram/login-screen";
import { TelegramOnboarding } from "@/components/telegram/onboarding";
import { ReplicaShell } from "@/components/telegram/replica-shell";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { telegramStatusFn } from "@/lib/telegram/fns";
import { useTelegram } from "@/lib/telegram/store";
import type { TelegramStatus } from "@/lib/telegram/types";

type TelegramSearch = { error?: string };

export const Route = createFileRoute("/telegram")({
  validateSearch: (search: Record<string, unknown>): TelegramSearch => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: TelegramDoor,
});

function TelegramDoor() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));
  const { error } = Route.useSearch();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [goApp, setGoApp] = useState(false);

  useEffect(() => {
    if (!signedIn || isPending) {
      setReady(!isPending);
      return;
    }
    let cancelled = false;
    void telegramStatusFn()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.onboarded || (s.linked && !s.hasOwnKey)) setGoApp(true);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, isPending]);

  useEffect(() => {
    if (!goApp) return;
    if (window.location.pathname !== "/telegram/app") {
      window.history.replaceState(null, "", "/telegram/app");
    }
  }, [goApp]);

  if (goApp) return <ReplicaShell />;

  const displayName = user?.displayName ?? user?.primaryEmail ?? undefined;

  if (!signedIn || isPending || (signedIn && !ready)) {
    return (
      <TelegramLoginScreen pending={isPending || (signedIn && !ready)} error={error ?? null} />
    );
  }

  return (
    <TelegramOnboarding
      status={status}
      displayName={displayName}
      error={error ?? null}
      onReady={() => setGoApp(true)}
      onPreview={() => {
        void useTelegram
          .getState()
          .enterPreview(displayName ?? "You")
          .then(() => setGoApp(true));
      }}
    />
  );
}
