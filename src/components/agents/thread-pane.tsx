import { Check, ChevronLeft, CirclePause, Hand, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatChatTime, formatDayLabel, sameDay } from "@/components/telegram/format";
import { cn } from "@/lib/utils";
import {
  messageAgent,
  personaName,
  threadAgent,
  wfLabel,
  type FloorDesk,
  type FloorMessage,
  type FloorSnapshot,
} from "./model";
import { TypingDots } from "./typing-dots";

export function ThreadPane({
  desk,
  snapshot,
  compose,
  onCompose,
  busy,
  typing,
  sending,
  showBack,
  autoSend,
  backgroundRun,
  onBack,
  onApprove,
  onDrop,
  onTakeover,
  onSend,
}: {
  desk: FloorDesk | null;
  snapshot: FloorSnapshot | null;
  compose: string;
  onCompose: (v: string) => void;
  busy: boolean;
  typing: boolean;
  sending: boolean;
  showBack: boolean;
  autoSend: boolean;
  backgroundRun: boolean;
  onBack: () => void;
  onApprove: (id: string, body?: string) => Promise<void>;
  onDrop: (id: string) => Promise<void>;
  onTakeover: (on: boolean) => Promise<void>;
  onSend: () => Promise<void>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const threadId = snapshot?.thread.id;
  const name = personaName(desk);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadId]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!near) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [snapshot?.messages.length, typing, sending]);

  if (!snapshot) {
    return (
      <EmptyFloor
        name={name}
        autoSend={autoSend}
        backgroundRun={backgroundRun}
        hasThreads={Boolean(desk && desk.threads.length > 0)}
      />
    );
  }

  const t = snapshot.thread;
  const agent = threadAgent(t) || name;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className="grid size-11 min-h-[44px] min-w-[44px] place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40"
            aria-label="Back"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 px-2">
          <p className="truncate text-sm font-medium">{t.fanName}</p>
          <p className="truncate font-mono text-xs uppercase tracking-widest text-subtle">
            {agent} · {wfLabel(t.workflow)} · {t.archetype.replaceAll("_", " ")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onTakeover(!t.takeover)}
          className={cn(
            "mr-1 flex h-11 min-h-[44px] items-center gap-2 rounded-md border px-3 text-xs",
            "transition-colors duration-[var(--motion-quick)] ease-[var(--ease-out)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40",
            t.takeover ? "border-warn/40 text-warn" : "border-border text-muted",
          )}
        >
          <Hand className="size-3.5" />
          {t.takeover ? "Human owns" : "Take over"}
        </button>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {snapshot.messages.map((m, i) => {
          const prev = snapshot.messages[i - 1];
          const dayBreak = !prev || !sameDay(prev.createdAt, m.createdAt);
          return (
            <div key={m.id} className="floor-bubble-enter">
              {dayBreak ? (
                <p className="my-3 text-center font-mono text-xs text-subtle">
                  {formatDayLabel(m.createdAt)}
                </p>
              ) : null}
              <Bubble
                message={m}
                fallbackName={agent}
                edit={edit[m.id]}
                onEdit={(v) => setEdit((s) => ({ ...s, [m.id]: v }))}
                onApprove={() => onApprove(m.id, edit[m.id])}
                onDrop={() => onDrop(m.id)}
                busy={busy}
              />
            </div>
          );
        })}
        {typing ? (
          <div className="flex justify-end">
            <div className="floor-bubble-enter rounded-xl rounded-br-sm bg-accent px-3 py-2 text-accent-fg">
              <p className="mb-1 font-mono text-xs uppercase tracking-widest opacity-70">{agent}</p>
              <TypingDots label={`${agent} is typing`} />
            </div>
          </div>
        ) : null}
        {sending ? (
          <div className="flex justify-end">
            <div className="rounded-xl rounded-br-sm border border-border bg-surface px-3 py-2 text-muted">
              <TypingDots label="Sending" />
            </div>
          </div>
        ) : null}
      </div>
      <form
        className="flex shrink-0 gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
      >
        <input
          value={compose}
          onChange={(e) => onCompose(e.target.value)}
          placeholder={t.takeover ? "You own this thread" : `Send as ${agent} (takes over)`}
          className="h-11 min-h-[44px] min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm outline-none transition-[border-color,box-shadow] duration-[var(--motion-quick)] placeholder:text-subtle focus:ring-2 focus:ring-fg/30"
        />
        <Button type="submit" size="icon" disabled={busy || sending || !compose.trim()} aria-label="Send">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}

function EmptyFloor({
  name,
  autoSend,
  backgroundRun,
  hasThreads,
}: {
  name: string;
  autoSend: boolean;
  backgroundRun: boolean;
  hasThreads: boolean;
}) {
  if (hasThreads) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium">{name} is on the floor.</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
            Open a thread to watch the conversation. Drafts stay visible until you approve or drop
            them.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        <p className="text-lg font-medium tracking-tight">{name} is waiting.</p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Auto-send lets rapport, aftercare, and check-ins go out on their own. Price, GFE, proof,
          and safety still hold for you.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Keep running so the desk still pulls and sends after you close this tab.
        </p>
        <p className="mt-4 font-mono text-xs uppercase tracking-widest text-subtle">
          Auto-send {autoSend ? "on" : "off"} · background {backgroundRun ? "on" : "off"}
        </p>
      </div>
    </div>
  );
}

function Bubble({
  message,
  fallbackName,
  edit,
  onEdit,
  onApprove,
  onDrop,
  busy,
}: {
  message: FloorMessage;
  fallbackName: string;
  edit?: string;
  onEdit: (v: string) => void;
  onApprove: () => void;
  onDrop: () => void;
  busy: boolean;
}) {
  const mine = message.role === "persona" || message.role === "draft";
  const draft = message.role === "draft" && message.status !== "dropped";
  const agent = messageAgent(message) || fallbackName;
  if (message.status === "dropped") return null;
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(28rem,92%)] rounded-xl px-3 py-2 text-sm leading-relaxed",
          message.role === "system" && "w-full bg-surface-2 text-center text-muted",
          message.role === "fan" && "rounded-bl-sm bg-surface-2 text-fg",
          message.role === "persona" && "rounded-br-sm bg-accent text-accent-fg",
          draft && "rounded-br-sm border border-dashed border-warn/50 bg-surface text-fg",
        )}
      >
        {message.role === "persona" || draft ? (
          <p
            className={cn(
              "mb-1 font-mono text-xs uppercase tracking-widest",
              draft ? "text-warn" : "opacity-60",
            )}
          >
            {draft ? "Draft · hold" : agent}
            {message.auto && !draft ? " · auto" : ""}
          </p>
        ) : null}
        {draft ? (
          <textarea
            value={edit ?? message.body}
            onChange={(e) => onEdit(e.target.value)}
            className="min-h-16 w-full resize-y bg-transparent text-sm outline-none"
            aria-label="Edit draft"
          />
        ) : (
          message.body.split("\n").map((line, i) => (
            <p key={i} className={i ? "mt-1" : undefined}>
              {line}
            </p>
          ))
        )}
        <p
          className={cn(
            "mt-1 text-right font-mono text-xs tabular-nums",
            message.role === "persona" ? "opacity-60" : "text-subtle",
          )}
        >
          {formatChatTime(message.createdAt)}
        </p>
        {draft ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onApprove}
              className="flex h-11 min-h-[44px] items-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-40"
            >
              <Check className="size-3.5" />
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDrop}
              className="flex h-11 min-h-[44px] items-center gap-1 rounded-md border border-border px-3 text-xs text-muted disabled:opacity-40"
            >
              <CirclePause className="size-3.5" />
              Drop
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
