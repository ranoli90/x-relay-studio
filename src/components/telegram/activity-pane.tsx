import { useEffect, useState } from "react";
import { loadOperatorDeskFn } from "@/lib/operator/fns";
import { publicSendLabel, type SendStatus } from "@/lib/operator/state";

const KNOWN: SendStatus[] = [
  "draft",
  "approved_not_sent",
  "queued",
  "sending",
  "confirmed",
  "failed",
  "uncertain",
  "canceled",
];

function label(status: string): string {
  if (KNOWN.includes(status as SendStatus)) return publicSendLabel(status as SendStatus);
  return status;
}

export function ActivityPane() {
  const [rows, setRows] = useState<
    Array<{ id: string; conversationId: string; status: string; body: string; createdAt: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadOperatorDeskFn()
      .then((desk) => {
        if (cancelled) return;
        setRows(desk.activity ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load activity.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center px-4">
        <h2 className="text-sm font-medium">Activity</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <p className="text-sm leading-relaxed text-[var(--tg-text-secondary)]">
          Send attempts on this desk. Uncertain results stay uncertain until reconciled. A cancel
          after bytes may have left is not proof of non-delivery.
        </p>
        {error ? (
          <p className="mt-3 text-sm text-down" role="alert">
            {error}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--tg-text-secondary)]">No send attempts yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl bg-[var(--tg-item-hover)] px-3 py-3 text-sm">
                <p className="font-medium">{label(row.status)}</p>
                <p className="mt-1 text-[var(--tg-text-secondary)]">{row.body.slice(0, 180)}</p>
                <p className="mt-1 font-mono text-[11px] text-[var(--tg-text-secondary)]">
                  {row.createdAt}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
