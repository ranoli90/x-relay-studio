import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return <Navigate to="/" />;
}
