import { createFileRoute, Outlet } from "@tanstack/react-router";

type TelegramSearch = { error?: string };

export const Route = createFileRoute("/telegram")({
  validateSearch: (search: Record<string, unknown>): TelegramSearch => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  staleTime: 30_000,
  component: TelegramLayout,
});

function TelegramLayout() {
  return <Outlet />;
}
