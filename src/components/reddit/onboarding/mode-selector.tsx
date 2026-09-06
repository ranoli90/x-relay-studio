import { useState } from "react";
import { Link2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ModeSelector({
  remainingSlots,
  accountCount,
  accountCap,
  createMax,
  busy,
  error,
  onCreate,
  onConnect,
}: {
  remainingSlots: number;
  accountCount: number;
  accountCap: number;
  createMax: number;
  busy: boolean;
  error: string | null;
  onCreate: (count: number) => void;
  onConnect: () => void;
}) {
  const maxPick = Math.max(0, Math.min(createMax, remainingSlots));
  const [count, setCount] = useState(1);
  const canCreate = maxPick > 0;
  const pick = Math.min(count, Math.max(1, maxPick));

  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Reddit</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">How do you want in?</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Pick how many accounts to make. The system and browser do the rest. Username and password
        show up here when each one is done. Or connect an account you already have.
      </p>

      <div className="mt-8 grid gap-3">
        <article className="rounded-xl border border-reddit/50 bg-surface p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-reddit text-reddit-fg">
              <UserPlus className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-medium tracking-tight">Create accounts</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Pick 1–{createMax}. We queue them and start the first now. No manual Reddit steps
                on this desk — stay here until the credentials appear.
              </p>
            </div>
          </div>

          <div
            role="radiogroup"
            aria-label="How many Reddit accounts to create"
            className="mt-5 grid grid-cols-5 gap-2"
          >
            {Array.from({ length: createMax }, (_, i) => i + 1).map((n) => {
              const allowed = n <= maxPick;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={pick === n}
                  aria-label={`${n} ${n === 1 ? "account" : "accounts"}`}
                  disabled={!allowed || busy}
                  onClick={() => setCount(n)}
                  className={cn(
                    "flex min-h-12 items-center justify-center rounded-lg border text-lg font-medium tabular-nums",
                    pick === n && allowed
                      ? "border-reddit bg-reddit text-reddit-fg"
                      : "border-border bg-surface-2 text-fg",
                    !allowed && "cursor-not-allowed opacity-40",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>

          <p className="mt-3 font-mono text-[11px] tracking-widest text-subtle uppercase">
            {accountCount} of {accountCap} used · {remainingSlots} open
          </p>

          <Button
            type="button"
            className="mt-4 min-h-12 w-full"
            disabled={!canCreate || busy}
            onClick={() => onCreate(pick)}
          >
            {busy ? "Starting…" : pick <= 1 ? "Make 1 account" : `Make ${pick} accounts`}
          </Button>
          {!canCreate ? (
            <p className="mt-3 text-sm text-warn">
              This desk is full. Disconnect one first, or connect an account you already use.
            </p>
          ) : null}
        </article>

        <article className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg">
              <Link2 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-medium tracking-tight">Connect my own</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Use a Reddit account you already have. You log in on Reddit. We never see that password.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-5 min-h-12 w-full"
            disabled={busy}
            onClick={onConnect}
          >
            Connect with Reddit
          </Button>
        </article>
      </div>

      {error ? <p className="mt-4 text-sm text-bad">{error}</p> : null}
    </section>
  );
}
