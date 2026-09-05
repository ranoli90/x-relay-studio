import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TelegramLoginScreen } from "@/components/telegram/login-screen";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { telegramStatusFn, telegramEnterPreviewFn } from "@/lib/telegram/fns";
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
        if (s.linked) setGoApp(true);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, isPending]);

  if (goApp) return <Navigate to="/telegram/app" />;

  const displayName = user?.displayName ?? user?.primaryEmail ?? undefined;

  return (
    <TelegramLoginScreen
      pending={isPending || (signedIn && !ready)}
      signedIn={signedIn && !isPending}
      status={status}
      displayName={displayName}
      error={error ?? null}
      onPreview={() => {
        void telegramEnterPreviewFn({ data: { displayName } }).then(() => setGoApp(true));
      }}
    />
  );
}
