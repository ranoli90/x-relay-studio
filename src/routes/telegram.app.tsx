import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ReplicaShell } from "@/components/telegram/replica-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { telegramStatusFn } from "@/lib/telegram/fns";
import { useTelegram } from "@/lib/telegram/store";

export const Route = createFileRoute("/telegram/app")({ component: TelegramApp });

function TelegramApp() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));
  const cached = useTelegram((s) => s.snapshot);
  const [gate, setGate] = useState<"load" | "onboard" | "app">(
    cached?.account ? "app" : "load",
  );

  useEffect(() => {
    if (cached?.account) {
      setGate("app");
      return;
    }
    if (!signedIn || isPending) return;
    let cancelled = false;
    void telegramStatusFn()
      .then((s) => {
        if (cancelled) return;
        setGate(s.onboarded || s.preview || (s.linked && !s.hasOwnKey) ? "app" : "onboard");
      })
      .catch(() => {
        if (!cancelled) setGate("onboard");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, isPending, cached?.account]);

  if (isPending && !sessionUser) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <Skeleton className="h-12 w-64 rounded-md" />
      </main>
    );
  }
  if (!signedIn) return <Navigate to="/telegram" />;
  if (gate === "load") {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <Skeleton className="h-12 w-64 rounded-md" />
      </main>
    );
  }
  if (gate === "onboard") return <Navigate to="/telegram" />;
  return <ReplicaShell />;
}