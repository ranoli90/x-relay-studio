import { createFileRoute, Navigate, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TelegramLoginScreen } from "@/components/telegram/login-screen";
import { TelegramOnboarding } from "@/components/telegram/onboarding";
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
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onDesk = pathname === "/telegram/app" || pathname.startsWith("/telegram/app/");
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));
  const { error } = Route.useSearch();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  useEffect(() => {
    if (onDesk) return;
    if (!signedIn || isPending) {
      setReady(!isPending);
      return;
    }
    let cancelled = false;
    void telegramStatusFn()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.onboarded || (s.linked && !s.hasOwnKey)) {
          void navigate({ to: "/telegram/app" });
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, isPending, navigate, onDesk]);

  if (onDesk) return <Outlet />;
  if (!signedIn && !isPending) return <Navigate to="/" />;

  const displayName = user?.displayName ?? undefined;

  if (!signedIn || isPending || (signedIn && !ready)) {
    return (
      <TelegramLoginScreen pending={isPending || (signedIn && !ready)} error={error ?? previewErr} />
    );
  }

  return (
    <TelegramOnboarding
      status={status}
      displayName={displayName}
      error={error ?? previewErr}
      onReady={() => {
        void navigate({ to: "/telegram/app" });
      }}
      onPreview={() => {
        setPreviewErr(null);
        void useTelegram
          .getState()
          .enterPreview(displayName ?? "You")
          .then(() => navigate({ to: "/telegram/app" }))
          .catch((e: unknown) => {
            setPreviewErr(e instanceof Error ? e.message : "Could not open preview.");
          });
      }}
    />
  );
}
