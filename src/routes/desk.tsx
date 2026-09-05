import { createFileRoute, Navigate } from "@tanstack/react-router";
import { DoorSkeleton } from "@/components/screen-stack";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/desk")({ component: DeskPage });

/** Fake Maya operator board is retired. Real chats + drafts live on Telegram. */
function DeskPage() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  if (isPending && !sessionUser) return <DoorSkeleton />;
  if (!user && !sessionUser) return <Navigate to="/" />;
  return <Navigate to="/telegram/app" />;
}
