import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

function requestId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return "local";
  }
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const id = requestId();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <span className="text-down" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-medium tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-muted" role="alert">
        {error.message || "An unexpected error occurred. Try reloading the page."}
      </p>
      <p className="font-mono text-[11px] tracking-wide text-muted">Ref {id}</p>
      <div className="mt-2 flex gap-4 text-sm">
        <a href="/" className="text-muted underline underline-offset-4 hover:text-fg">
          Back to the desk
        </a>
        <button
          type="button"
          className="text-muted underline underline-offset-4 hover:text-fg"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </main>
  );
}
