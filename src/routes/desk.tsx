import { createFileRoute, Navigate } from "@tanstack/react-router";
import { DeskShell } from "@/components/desk/desk-shell";
import { DoorSkeleton } from "@/components/screen-stack";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/desk")({ component: DeskPage });

function DeskPage() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  if (isPending && !sessionUser) return <DoorSkeleton />;
  if (!user && !sessionUser) return <Navigate to="/" />;
  return (
    <main id="main" className="h-dvh">
      <DeskShell />
    </main>
  );
}
