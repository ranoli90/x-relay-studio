import { createFileRoute, Navigate } from "@tanstack/react-router";
import { LoginScreen } from "@/components/studio/login-screen";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { sessionUser } = Route.useRouteContext();
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user) || (isPending && Boolean(sessionUser));
  if (signedIn) return <Navigate to="/" />;
  return <LoginScreen pending={isPending} />;
}
