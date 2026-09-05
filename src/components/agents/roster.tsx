import { cn } from "@/lib/utils";
import {
  deskActivity,
  deskRoster,
  initialOf,
  rosterStatus,
  toneAvatarClass,
  toneOf,
  type FloorDesk,
} from "./model";
import { TypingDots } from "./typing-dots";

export function AgentRoster({
  desk,
  selected,
  onSelect,
  compact,
}: {
  desk: FloorDesk;
  selected: string | null;
  onSelect: (name: string | null) => void;
  compact?: boolean;
}) {
  const roster = deskRoster(desk);
  const activity = deskActivity(desk);

  if (compact) {
    return (
      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {roster.map((row) => {
          const status = rosterStatus(row, activity);
          const on = selected === row.name;
          return (
            <button
              key={row.name}
              type="button"
              onClick={() => onSelect(on ? null : row.name)}
              className={cn(
                "flex h-11 min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-3",
                "transition-[background-color,border-color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40",
                on ? "border-fg/30 bg-surface-2" : "border-border bg-bg",
              )}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-xs font-medium",
                  toneAvatarClass(toneOf(row.tone)),
                )}
              >
                {initialOf(row.name)}
              </span>
              <span className="text-xs font-medium">{row.name}</span>
              <StatusMark status={status} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {roster.map((row) => {
        const status = rosterStatus(row, activity);
        const on = selected === row.name;
        return (
          <li key={row.name}>
            <button
              type="button"
              onClick={() => onSelect(on ? null : row.name)}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-3 px-3 py-2.5 text-left",
                "transition-colors duration-[var(--motion-quick)] ease-[var(--ease-out)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/40",
                on ? "bg-surface-2" : "hover:bg-surface-2/60",
              )}
            >
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-full text-sm font-medium",
                  toneAvatarClass(toneOf(row.tone)),
                )}
              >
                {initialOf(row.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{row.name}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-subtle">
                    {row.threadCount}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                  <StatusMark status={status} />
                  <span className="capitalize">{status}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StatusMark({ status }: { status: "live" | "idle" | "typing" }) {
  if (status === "typing") {
    return <TypingDots className="text-muted" label="Typing" />;
  }
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "live" ? "bg-up" : "bg-subtle",
      )}
      aria-hidden="true"
    />
  );
}
