import { formatChatTime } from "@/components/telegram/format";
import { formatUsd } from "@/lib/agent/catalog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useFlipList } from "./flip";
import {
  isHeldState,
  personaName,
  sortFloorThreads,
  threadAgent,
  wfLabel,
  type FloorDesk,
} from "./model";

export function FloorThreadList({
  desk,
  selected,
  agentFilter,
  onOpen,
}: {
  desk: FloorDesk | null;
  selected: string | null;
  agentFilter: string | null;
  onOpen: (id: string) => void;
}) {
  const owner = desk ? personaName(desk) : "";
  const rows = desk
    ? sortFloorThreads(desk.threads).filter((t) => {
        if (!agentFilter) return true;
        const agent = threadAgent(t);
        if (!agent) return agentFilter === owner;
        return agent === agentFilter;
      })
    : [];
  const bind = useFlipList(rows.map((t) => t.id));

  if (!desk) {
    return (
      <div className="flex-1 space-y-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-4 text-center text-sm text-muted">
        {agentFilter
          ? `${agentFilter} has no threads yet.`
          : "No threads yet. Run a scenario or wait for inbound."}
      </div>
    );
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {rows.map((t) => {
        const agent = threadAgent(t);
        const held = isHeldState(t.state);
        return (
          <li key={t.id} ref={bind(t.id)}>
            <button
              type="button"
              onClick={() => onOpen(t.id)}
              className={cn(
                "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left",
                "transition-colors duration-[var(--motion-quick)] ease-[var(--ease-out)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/40",
                selected === t.id ? "bg-surface-2" : "hover:bg-surface-2/60",
                held && "opacity-80",
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-medium">
                {t.fanName.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{t.fanName}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-subtle">
                    {formatChatTime(t.lastAt)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="truncate text-xs text-muted">{t.lastPreview || "No messages yet"}</span>
                  {t.unread > 0 ? (
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xs text-accent-fg">
                      {t.unread}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  <Tag>{wfLabel(t.workflow)}</Tag>
                  {agent ? <Tag>{agent}</Tag> : null}
                  {t.takeover ? <Tag warn>takeover</Tag> : null}
                  {held ? <Tag warn>{t.state}</Tag> : null}
                  {t.lifetimeCents > 0 ? <Tag>{formatUsd(t.lifetimeCents)}</Tag> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Tag({ children, warn }: { children: string; warn?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 font-mono text-xs uppercase tracking-wider",
        warn ? "bg-warn/15 text-warn" : "bg-surface-2 text-subtle",
      )}
    >
      {children}
    </span>
  );
}
