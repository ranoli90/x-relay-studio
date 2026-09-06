import {
  ArrowDownLeft,
  Check,
  CirclePause,
  Hand,
  ShieldOff,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { formatChatTime } from "@/components/telegram/format";
import { formatUsd } from "@/lib/agent/catalog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  deskActivity,
  personaName,
  safeCallOutcome,
  wfLabel,
  type ActivityRow,
  type FloorDesk,
  type FloorSnapshot,
} from "./model";
import { TypingDots } from "./typing-dots";

export function ActivityFeed({
  desk,
  snapshot,
  onPay,
  onDeliver,
  onOpen,
}: {
  desk: FloorDesk | null;
  snapshot: FloorSnapshot | null;
  onPay: (id: string) => void;
  onDeliver: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  if (!desk) {
    return (
      <div className="space-y-3 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  const rows = deskActivity(desk);
  const name = personaName(desk);
  const emergencyStop = Boolean(desk.persona.emergencyStop);
  const autoSend = Boolean(desk.persona.autoSend) && !emergencyStop;
  const planHeld = Boolean(snapshot?.plan?.hold) || emergencyStop || !autoSend;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Live</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {snapshot?.plan ? (
          <div className="border-b border-border px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">
              {wfLabel(snapshot.plan.workflow)}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{snapshot.plan.reason}</p>
            <p className="mt-2 font-mono text-xs text-subtle">
              {snapshot.plan.strategy} · {snapshot.plan.tactic}
              {planHeld ? " · hold" : " · auto"}
            </p>
          </div>
        ) : null}
        {snapshot?.offers.length ? (
          <ul className="border-b border-border px-4 py-3 space-y-2">
            {snapshot.offers.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {o.sku} {formatUsd(o.priceCents)}
                  <span className="ml-2 font-mono text-xs uppercase text-subtle">{o.status}</span>
                </span>
                {o.status === "sent" ? (
                  <button
                    type="button"
                    className="h-11 min-h-[44px] px-2 text-xs text-up"
                    onClick={() => onPay(o.id)}
                  >
                    Mark paid
                  </button>
                ) : null}
                {o.status === "paid" ? (
                  <button
                    type="button"
                    className="h-11 min-h-[44px] px-2 text-xs text-up"
                    onClick={() => onDeliver(o.id)}
                  >
                    Deliver
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {desk.calls?.length ? (
          <div className="border-b border-border px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">Calls</p>
            <ul className="mt-2 space-y-1.5">
              {desk.calls.slice(0, 6).map((c) => {
                const outcome = safeCallOutcome(c.outcome);
                const failed = outcome !== "ok" && outcome !== "local";
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "flex items-baseline justify-between gap-2 font-mono text-xs",
                      failed ? "text-down" : "text-muted",
                    )}
                  >
                    <span className="min-w-0 truncate uppercase tracking-wider">
                      {c.task}
                      {c.fallback ? " · fallback" : ""}
                    </span>
                    <span className="shrink-0">{outcome}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {snapshot?.diary.length ? (
          <div className="border-b border-border px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">Memory</p>
            <ul className="mt-2 space-y-2">
              {snapshot.diary.slice(0, 3).map((d) => (
                <li key={d.id} className="text-sm leading-relaxed text-muted">
                  <span className="font-mono text-xs uppercase tracking-wider text-subtle">{d.voice}</span>
                  <span className="mt-0.5 block">{d.body}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {snapshot?.thoughts.length ? (
          <div className="border-b border-border px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">Desk</p>
            <ul className="mt-2 space-y-1.5">
              {snapshot.thoughts.slice(0, 4).map((th) => (
                <li key={th.id} className="text-xs leading-relaxed text-muted">
                  <span className="font-mono uppercase tracking-wider text-subtle">{th.kind}</span>
                  <span className="ml-2">{th.body}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-sm leading-relaxed text-muted">
            Quiet. Inbound, typing, and sends from {name} land here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <ActivityItem key={row.id} row={row} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActivityItem({ row, onOpen }: { row: ActivityRow; onOpen?: (id: string) => void }) {
  const inner = (
    <>
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-md", kindTone(row.kind))}>
        {kindIcon(row.kind)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{row.agentName}</span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-subtle">
            {formatChatTime(row.createdAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span className="font-mono uppercase tracking-wider">{row.kind}</span>
          {row.kind === "typing" ? <TypingDots className="text-muted" /> : null}
        </span>
        {row.body ? (
          <p className="mt-1 truncate text-sm leading-relaxed text-muted">{row.body}</p>
        ) : null}
      </span>
    </>
  );
  if (row.threadId && onOpen) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpen(row.threadId!)}
          className="flex w-full gap-3 px-4 py-3 text-left transition-colors duration-[var(--motion-quick)] ease-[var(--ease-out)] hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/40"
        >
          {inner}
        </button>
      </li>
    );
  }
  return <li className="flex gap-3 px-4 py-3">{inner}</li>;
}

function kindTone(kind: string): string {
  switch (kind) {
    case "sent":
      return "bg-up/15 text-up";
    case "held":
    case "handoff":
      return "bg-warn/15 text-warn";
    case "killed":
    case "failed":
      return "bg-down/15 text-down";
    case "typing":
      return "bg-surface-2 text-muted";
    default:
      return "bg-surface-2 text-fg";
  }
}

function kindIcon(kind: string): ReactNode {
  switch (kind) {
    case "inbound":
      return <ArrowDownLeft className="size-3.5" />;
    case "sent":
      return <Check className="size-3.5" />;
    case "held":
      return <CirclePause className="size-3.5" />;
    case "handoff":
      return <Hand className="size-3.5" />;
    case "killed":
      return <ShieldOff className="size-3.5" />;
    case "failed":
      return <X className="size-3.5" />;
    default:
      return <span className="size-1.5 rounded-full bg-current" />;
  }
}
