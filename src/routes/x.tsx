import { createFileRoute, Navigate } from "@tanstack/react-router";
import { DoorSkeleton } from "@/components/screen-stack";
import { Studio } from "@/components/studio/studio";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/x")({ component: XHome });

function XHome() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  if (!user && !sessionUser) return <Navigate to="/" />;
  if (isPending && !user) return <DoorSkeleton />;
  if (!user) return <Navigate to="/" />;
  return <Studio />;
}
