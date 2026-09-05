import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/status")({
  component: StatusPage,
});

function StatusPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-bg px-4 py-16 text-fg">
      <p className="font-mono text-xs uppercase tracking-widest text-muted">X Relay</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Status</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        This page is a static heartbeat for the app process. Connector health
        (Reddit OAuth, Telegram DC, OpenRouter) is per-desk and is not published
        here.
      </p>
      <p className="mt-6 font-mono text-sm text-ok">app: up</p>
      <p className="mt-10 text-sm text-muted">
        <Link to="/" className="underline underline-offset-4 hover:text-fg">
          Back to the desk
        </Link>
      </p>
    </main>
  );
}
