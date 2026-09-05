import { createFileRoute, Navigate } from "@tanstack/react-router";
import { DoorSkeleton } from "@/components/screen-stack";
import { RedditApp } from "@/components/reddit/app";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/reddit")({ component: RedditDoor });

function RedditDoor() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  if (!user && !sessionUser) return <Navigate to="/" />;
  if (isPending && !user) return <DoorSkeleton />;
  if (!user) return <Navigate to="/" />;
  return <RedditApp />;
}
