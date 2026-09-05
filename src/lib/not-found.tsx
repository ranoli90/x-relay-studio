import { Link } from "@tanstack/react-router";

export function AppNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center text-fg">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">404</p>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">That page is not on this desk.</h1>
        <p className="mt-3 text-sm text-muted">The URL does not match a route in X Relay.</p>
        <p className="mt-6">
          <Link to="/" className="text-sm underline underline-offset-4 hover:text-fg">
            Back to the desk
          </Link>
        </p>
      </div>
    </main>
  );
}
