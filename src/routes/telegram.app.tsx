import { createFileRoute, Navigate } from "@tanstack/react-router";
import { ReplicaShell } from "@/components/telegram/replica-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/telegram/app")({ component: TelegramApp });

function TelegramApp() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));

  if (isPending && !sessionUser) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <Skeleton className="h-12 w-64 rounded-md" />
      </main>
    );
  }
  if (!signedIn) return <Navigate to="/telegram" />;
  return <ReplicaShell />;
}
