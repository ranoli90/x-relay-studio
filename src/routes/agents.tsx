import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AgentsFloor } from "@/components/agents/agents-floor";
import { DoorSkeleton } from "@/components/screen-stack";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/agents")({ component: AgentsPage });

function AgentsPage() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  if (isPending && !sessionUser) return <DoorSkeleton />;
  if (!user && !sessionUser) return <Navigate to="/" />;
  return <AgentsFloor />;
}
