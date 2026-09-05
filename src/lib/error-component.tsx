import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

function redact(message: string): string {
  return message
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[redacted-openrouter-key]")
    .replace(/v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-envelope]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : String(Date.now());
  const raw = error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <span className="text-down" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-medium tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-muted">{redact(raw)}</p>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtle">Ref {requestId}</p>
      <button
        type="button"
        className="mt-2 text-sm text-fg underline-offset-2 hover:underline"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </main>
  );
}
