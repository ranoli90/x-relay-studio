import { createFileRoute } from "@tanstack/react-router";
import { LoginScreen } from "@/components/studio/login-screen";
import { Studio } from "@/components/studio/studio";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/x")({ component: XHome });

function XHome() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));
  if (signedIn) return <Studio />;
  return <LoginScreen pending={isPending} />;
}
