import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Studio } from "@/components/studio/studio";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/x")({ component: XHome });

function XHome() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));
  if (isPending && !sessionUser) {
    return (
      <div className="min-h-dvh bg-bg p-8">
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }
  if (!signedIn) return <Navigate to="/" />;
  return <Studio />;
}
