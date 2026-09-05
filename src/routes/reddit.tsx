import { createFileRoute, Navigate } from "@tanstack/react-router";
import { RedditApp } from "@/components/reddit/app";
import { AnonymousDesk } from "@/components/studio/anonymous-desk";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/reddit")({ component: RedditDoor });

function RedditDoor() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));
  if (!signedIn && !isPending) return <Navigate to="/" />;
  if (!signedIn) {
    return <AnonymousDesk onReady={() => window.location.assign("/reddit")} />;
  }
  return <RedditApp />;
}
