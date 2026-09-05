import { createFileRoute, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DoorSkeleton } from "@/components/screen-stack";
import { TelegramOnboarding } from "@/components/telegram/onboarding";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { telegramStatusFn } from "@/lib/telegram/fns";
import { useTelegram } from "@/lib/telegram/store";
import type { TelegramStatus } from "@/lib/telegram/types";

export const Route = createFileRoute("/telegram/")({
  staleTime: 30_000,
  component: TelegramDoor,
});

function TelegramDoor() {
  const navigate = useNavigate();
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || Boolean(sessionUser);
  const { error } = useSearch({ from: "/telegram" });
  const cached = useTelegram((s) => s.snapshot);
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [ready, setReady] = useState(Boolean(cached?.account));
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  useEffect(() => {
    if (cached?.account) return;
    if (!signedIn || isPending) {
      setReady(!isPending);
      return;
    }
    let cancelled = false;
    void telegramStatusFn()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        setStatusErr(null);
        if (s.onboarded) {
          void navigate({ to: "/telegram/app" });
        }
        setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "";
        setStatusErr(
          msg === "Unauthorized"
            ? "This desk didn’t stay signed in. Open it again from the home screen."
            : "Could not load this desk.",
        );
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, isPending, navigate, cached?.account]);

  if (cached?.account) return <Navigate to="/telegram/app" />;

  // Desk number is the account. Never start X/Google from this door —
  // that client is preview-only and X rejects the production callback.
  if (!signedIn && !isPending) return <Navigate to="/" />;

  const displayName = user?.displayName ?? undefined;

  if (!signedIn || isPending || (signedIn && !ready)) {
    return <DoorSkeleton />;
  }

  return (
    <TelegramOnboarding
      status={status}
      displayName={displayName}
      error={error ?? previewErr ?? statusErr}
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
