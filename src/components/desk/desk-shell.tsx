import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  CirclePause,
  Clock,
  Hand,
  Radio,
  Send,
  Shield,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { formatChatTime } from "@/components/telegram/format";
import {
  approveDraft,
  dropDraft,
  loadDesk,
  loadThread,
  markDelivered,
  operatorSend,
  patchDiary,
  setAutoSend,
  setTakeover,
  simulateInbound,
  simulatePay,
} from "@/lib/agent/fns";
import { formatUsd } from "@/lib/agent/catalog";
import type {
  DeskSnapshot,
  OperatorMessage,
  ThreadSnapshot,
  WorkflowId,
} from "@/lib/agent/types";
import { UserButton } from "@/lib/auth/gates";
import { cn } from "@/lib/utils";

const SCENARIOS: { id: string; label: string }[] = [
  { id: "quick_buy", label: "Price ask" },
  { id: "gfe", label: "GFE" },
  { id: "burned", label: "Burned" },
  { id: "real", label: "Are you real" },
  { id: "meetup", label: "Meetup" },
  { id: "injection", label: "Injection" },
  { id: "crisis", label: "Crisis" },
  { id: "minor", label: "18+ kill" },
];

function wfLabel(id: WorkflowId | string): string {
  return id.replace(/^W\d+_/, "").replaceAll("_", " ");
}

export function DeskShell() {
  const [desk, setDesk] = useState<DeskSnapshot | null>(null);
  const [thread, setThread] = useState<ThreadSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState<"chats" | "thread" | "mind">("chats");
  const [narrow, setNarrow] = useState(false);
  const [sim, setSim] = useState("");
  const [compose, setCompose] = useState("");
  const [mindTab, setMindTab] = useState<"thought" | "diary" | "plan">("thought");

  const reload = useCallback(async (threadId?: string) => {
    const d = await loadDesk();
    setDesk(d);
    const id = threadId ?? thread?.thread.id;
    if (id) {
      const t = await loadThread({ data: { threadId: id } });
      setThread(t);
    }
  }, [thread?.thread.id]);

  useEffect(() => {
    void loadDesk()
      .then(setDesk)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Desk failed to load."));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  async function openThread(id: string) {
    setBusy(true);
    setError(null);
    try {
      const t = await loadThread({ data: { threadId: id } });
      setThread(t);
      if (narrow) setPane("thread");
      const d = await loadDesk();
      setDesk(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open thread.");
    } finally {
      setBusy(false);
    }
  }

  async function run(text: string, scenario?: string) {
    if (!thread && !scenario && !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await simulateInbound({
        data: { threadId: thread?.thread.id, text, scenario },
      });
      await reload(res.threadId);
      setSim("");
      if (narrow) setPane("thread");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Brain failed.");
    } finally {
      setBusy(false);
    }
  }

  const selected = thread?.thread.id ?? null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border bg-bg px-3 [padding-top:env(safe-area-inset-top)]">
        <Link to="/" className="shrink-0" aria-label="Home">
          <Logo className="size-7" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium tracking-tight">
            {desk?.persona.displayName ?? "Desk"} operator
          </p>
          <p className="truncate font-mono text-[11px] uppercase tracking-widest text-subtle">
            {desk ? desk.persona.clockLabel : "loading"}
            {desk?.persona.quiet ? " · quiet hours" : ""}
          </p>
        </div>
        <Seats seats={desk?.seats ?? []} />
        <EvalChip passed={desk?.eval.passed ?? 0} total={desk?.eval.total ?? 0} />
        <AutoChip
          on={Boolean(desk?.persona.autoSend)}
          allowed={Boolean(desk?.eval.autoSendAllowed)}
          busy={busy}
          onToggle={async (on) => {
            setBusy(true);
            setError(null);
            try {
              await setAutoSend({ data: { on } });
              const d = await loadDesk();
              setDesk(d);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not change auto-send.");
            } finally {
              setBusy(false);
            }
          }}
        />
        <UserButton />
      </header>

      {error ? (
        <div className="flex items-center justify-between gap-3 border-b border-down/30 bg-down/10 px-3 py-2 text-sm text-down">
          <p>{error}</p>
          <button type="button" className="size-11" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {narrow ? (
        <nav className="flex border-b border-border">
          {(["chats", "thread", "mind"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPane(id)}
              className={cn(
                "h-11 flex-1 text-sm font-medium capitalize",
                pane === id ? "text-fg" : "text-muted",
              )}
            >
              {id}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "flex w-full shrink-0 flex-col border-r border-border bg-surface lg:w-[20rem]",
            narrow && pane !== "chats" && "hidden",
          )}
        >
          <ThreadList
            desk={desk}
            selected={selected}
            onOpen={(id) => void openThread(id)}
          />
          <Simulator
            value={sim}
            onChange={setSim}
            busy={busy}
            onSend={() => void run(sim)}
            onScenario={(id) => void run("", id)}
          />
        </aside>

        <section
          className={cn(
            "tg-replica min-w-0 flex-1",
            narrow && pane !== "thread" && "hidden",
          )}
        >
          <ThreadColumn
            snapshot={thread}
            compose={compose}
            onCompose={setCompose}
            busy={busy}
            showBack={narrow}
            onBack={() => setPane("chats")}
            onApprove={async (id, body) => {
              setBusy(true);
              try {
                await approveDraft({ data: { messageId: id, body } });
                await reload();
              } finally {
                setBusy(false);
              }
            }}
            onDrop={async (id) => {
              await dropDraft({ data: { messageId: id } });
              await reload();
            }}
            onTakeover={async (on) => {
              if (!thread) return;
              await setTakeover({ data: { threadId: thread.thread.id, on } });
              await reload();
            }}
            onSend={async () => {
              if (!thread || !compose.trim()) return;
              setBusy(true);
              try {
                await operatorSend({ data: { threadId: thread.thread.id, body: compose } });
                setCompose("");
                await reload();
              } finally {
                setBusy(false);
              }
            }}
          />
        </section>

        <aside
          className={cn(
            "flex w-full shrink-0 flex-col border-l border-border bg-bg lg:w-[22rem]",
            narrow && pane !== "mind" && "hidden",
            !narrow && "hidden lg:flex",
          )}
        >
          <MindRail
            desk={desk}
            snapshot={thread}
            tab={mindTab}
            onTab={setMindTab}
            onDiary={async (voice, body) => {
              if (!thread) return;
              await patchDiary({ data: { fanId: thread.thread.fanId, voice, body } });
              await reload();
            }}
            onPay={async (id) => {
              await simulatePay({ data: { offerId: id } });
              await reload();
            }}
            onDeliver={async (id) => {
              await markDelivered({ data: { offerId: id } });
              await reload();
            }}
          />
        </aside>
      </div>
    </div>
  );
}

function Seats({ seats }: { seats: { kind: string; capacity: number; held: number }[] }) {
  const gfe = seats.find((s) => s.kind === "gfe");
  if (!gfe) return null;
  const left = gfe.capacity - gfe.held;
  return (
    <span className="hidden items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-subtle sm:flex">
      <Radio className="size-3.5" />
      GFE {left}/{gfe.capacity}
    </span>
  );
}

function EvalChip({ passed, total }: { passed: number; total: number }) {
  const ok = total > 0 && passed === total;
  return (
    <span
      className={cn(
        "hidden items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] uppercase tracking-widest sm:flex",
        ok ? "border-up/40 text-up" : "border-warn/40 text-warn",
      )}
    >
      <Shield className="size-3.5" />
      eval {passed}/{total}
    </span>
  );
}

function AutoChip({
  on,
  allowed,
  busy,
  onToggle,
}: {
  on: boolean;
  allowed: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={busy || (!allowed && !on)}
      onClick={() => onToggle(!on)}
      title={allowed ? "Auto-send for rapport / aftercare only" : "Gold threads have to pass first"}
      className={cn(
        "hidden h-10 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px] uppercase tracking-widest sm:flex",
        on ? "border-up/40 text-up" : "border-border text-subtle",
      )}
    >
      Auto {on ? "on" : "off"}
    </button>
  );
}

function ThreadList({
  desk,
  selected,
  onOpen,
}: {
  desk: DeskSnapshot | null;
  selected: string | null;
  onOpen: (id: string) => void;
}) {
  if (!desk) {
    return (
      <div className="flex-1 space-y-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    );
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {desk.threads.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onOpen(t.id)}
            className={cn(
              "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left",
              selected === t.id ? "bg-surface-2" : "hover:bg-surface-2/60",
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-medium">
              {t.fanName.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{t.fanName}</span>
                <span className="shrink-0 font-mono text-[10px] text-subtle">
                  {formatChatTime(t.lastAt)}
                </span>
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className="truncate text-xs text-muted">{t.lastPreview}</span>
                {t.unread > 0 ? (
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] text-accent-fg">
                    {t.unread}
                  </span>
                ) : null}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                <Badge>{wfLabel(t.workflow)}</Badge>
                {t.takeover ? <Badge warn>takeover</Badge> : null}
                {t.lifetimeCents > 0 ? <Badge>{formatUsd(t.lifetimeCents)}</Badge> : <Badge>unpaid</Badge>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Badge({ children, warn }: { children: string; warn?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        warn ? "bg-warn/15 text-warn" : "bg-surface-2 text-subtle",
      )}
    >
      {children}
    </span>
  );
}

function Simulator({
  value,
  onChange,
  busy,
  onSend,
  onScenario,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onSend: () => void;
  onScenario: (id: string) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">Inbound simulator</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            onClick={() => onScenario(s.id)}
            className="h-8 rounded-md border border-border px-2 text-xs text-muted hover:text-fg"
          >
            {s.label}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Fan says…"
          className="h-11 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm outline-none focus:ring-2 focus:ring-fg/30"
        />
        <Button type="submit" size="icon" disabled={busy || !value.trim()} aria-label="Run brain">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}

function ThreadColumn({
  snapshot,
  compose,
  onCompose,
  busy,
  showBack,
  onBack,
  onApprove,
  onDrop,
  onTakeover,
  onSend,
}: {
  snapshot: ThreadSnapshot | null;
  compose: string;
  onCompose: (v: string) => void;
  busy: boolean;
  showBack: boolean;
  onBack: () => void;
  onApprove: (id: string, body?: string) => Promise<void>;
  onDrop: (id: string) => Promise<void>;
  onTakeover: (on: boolean) => Promise<void>;
  onSend: () => Promise<void>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot?.messages.length, snapshot?.thread.id]);

  if (!snapshot) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted">
        Select a thread. Thoughts never send.
      </div>
    );
  }
  const t = snapshot.thread;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-2">
        {showBack ? (
          <button type="button" onClick={onBack} className="grid size-11 place-items-center" aria-label="Back">
            <ChevronLeft className="size-5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 px-2">
          <p className="truncate text-sm font-medium text-white">{t.fanName}</p>
          <p className="truncate font-mono text-[10px] uppercase tracking-widest text-white/50">
            {wfLabel(t.workflow)} · {t.archetype.replaceAll("_", " ")} · trust {t.trust}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onTakeover(!t.takeover)}
          className={cn(
            "mr-2 flex h-10 items-center gap-2 rounded-md border px-3 text-xs",
            t.takeover ? "border-warn/40 text-warn" : "border-white/15 text-white/70",
          )}
        >
          <Hand className="size-3.5" />
          {t.takeover ? "Human owns" : "Take over"}
        </button>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {snapshot.messages.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            edit={edit[m.id]}
            onEdit={(v) => setEdit((s) => ({ ...s, [m.id]: v }))}
            onApprove={() => onApprove(m.id, edit[m.id])}
            onDrop={() => onDrop(m.id)}
            busy={busy}
          />
        ))}
      </div>
      <form
        className="flex shrink-0 gap-2 border-t border-white/10 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
      >
        <input
          value={compose}
          onChange={(e) => onCompose(e.target.value)}
          placeholder={t.takeover ? "You own this thread" : "Send as Maya (takes over)"}
          className="h-11 min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/40"
        />
        <Button type="submit" size="icon" disabled={busy || !compose.trim()} aria-label="Send">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}

function Bubble({
  message,
  edit,
  onEdit,
  onApprove,
  onDrop,
  busy,
}: {
  message: OperatorMessage;
  edit?: string;
  onEdit: (v: string) => void;
  onApprove: () => void;
  onDrop: () => void;
  busy: boolean;
}) {
  const mine = message.role === "persona" || message.role === "draft";
  const draft = message.role === "draft" && message.status !== "dropped";
  if (message.status === "dropped") return null;
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(28rem,92%)] rounded-xl px-3 py-2 text-sm leading-relaxed",
          message.role === "system" && "w-full bg-white/5 text-center text-white/60",
          message.role === "fan" && "rounded-bl-sm bg-white/10 text-white",
          message.role === "persona" && "rounded-br-sm bg-[#766ac8] text-white",
            draft && "rounded-br-sm border border-dashed border-white/40 bg-black/40 text-[var(--tg-text)]",
        )}
      >
        {draft ? (
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-white/50">
            Draft · hold · never auto
          </p>
        ) : null}
        {draft ? (
          <textarea
            value={edit ?? message.body}
            onChange={(e) => onEdit(e.target.value)}
            className="min-h-16 w-full resize-y bg-transparent text-sm outline-none"
          />
        ) : (
          message.body.split("\n").map((line, i) => (
            <p key={i} className={i ? "mt-1" : undefined}>
              {line}
            </p>
          ))
        )}
        {draft ? (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onApprove}
              className="flex h-9 items-center gap-1 rounded-md bg-white px-3 text-xs font-medium text-black"
            >
              <Check className="size-3.5" />
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDrop}
              className="flex h-9 items-center gap-1 rounded-md border border-white/20 px-3 text-xs text-white/80"
            >
              <CirclePause className="size-3.5" />
              Hold
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MindRail({
  desk,
  snapshot,
  tab,
  onTab,
  onDiary,
  onPay,
  onDeliver,
}: {
  desk: DeskSnapshot | null;
  snapshot: ThreadSnapshot | null;
  tab: "thought" | "diary" | "plan";
  onTab: (t: "thought" | "diary" | "plan") => void;
  onDiary: (voice: "HIM" | "ME" | "US", body: string) => Promise<void>;
  onPay: (id: string) => Promise<void>;
  onDeliver: (id: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [voice, setVoice] = useState<"HIM" | "ME" | "US">("HIM");
  const catalog = desk?.catalog ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex border-b border-border">
        {(["thought", "diary", "plan"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onTab(id)}
            className={cn(
              "h-11 flex-1 text-xs font-medium uppercase tracking-wider",
              tab === id ? "text-fg" : "text-muted",
            )}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "thought" ? (
          <ul className="space-y-3">
            {(snapshot?.thoughts ?? []).map((th) => (
              <li key={th.id}>
                <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">{th.kind}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{th.body}</p>
              </li>
            ))}
            {!snapshot ? <p className="text-sm text-muted">Thoughts never send.</p> : null}
          </ul>
        ) : null}
        {tab === "diary" ? (
          <div>
            <ul className="space-y-3">
              {(snapshot?.diary ?? []).map((d) => (
                <li key={d.id}>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">{d.voice}</p>
                  <p className="mt-1 text-sm leading-relaxed">{d.body}</p>
                </li>
              ))}
            </ul>
            {snapshot ? (
              <form
                className="mt-4 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  void onDiary(voice, note).then(() => setNote(""));
                }}
              >
                <div className="flex gap-1">
                  {(["HIM", "ME", "US"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVoice(v)}
                      className={cn(
                        "h-8 rounded-md px-2 font-mono text-[10px]",
                        voice === v ? "bg-surface-2 text-fg" : "text-muted",
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Operator correction (gold label)"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none"
                />
                <Button type="submit" variant="secondary" className="w-full">
                  Patch diary
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
        {tab === "plan" ? (
          <div className="space-y-4">
            {snapshot?.plan ? (
              <div className="rounded-xl border border-border bg-surface p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                  {wfLabel(snapshot.plan.workflow)}
                </p>
                <p className="mt-2 text-sm leading-relaxed">{snapshot.plan.reason}</p>
                <p className="mt-3 font-mono text-[11px] text-muted">
                  {snapshot.plan.strategy} · {snapshot.plan.tactic}
                  {snapshot.plan.hold ? " · hold" : " · auto"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">No plan yet.</p>
            )}
            {snapshot?.offers.length ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">Offers</p>
                <ul className="mt-2 space-y-2">
                  {snapshot.offers.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                      <span className="text-sm">
                        {o.sku} {formatUsd(o.priceCents)}
                        <span className="ml-2 font-mono text-[10px] uppercase text-subtle">{o.status}</span>
                      </span>
                      {o.status === "sent" ? (
                        <button type="button" className="text-xs text-up" onClick={() => void onPay(o.id)}>
                          Webhook paid
                        </button>
                      ) : null}
                      {o.status === "paid" ? (
                        <button type="button" className="text-xs text-up" onClick={() => void onDeliver(o.id)}>
                          Deliver
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {desk?.tickets.length ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">Tickets</p>
                <ul className="mt-2 space-y-2">
                  {desk.tickets.map((t) => (
                    <li key={t.id} className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
                      {t.body}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">Catalog allowlist</p>
              <ul className="mt-2 space-y-1">
                {catalog.map((c) => (
                  <li key={c.id} className="flex justify-between text-sm">
                    <span>{c.title}</span>
                    <span className="font-mono text-muted">
                      {formatUsd(c.priceCents)} · {c.rail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {desk?.calls.length ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                  <Clock className="mr-1 inline size-3" />
                  Model log
                </p>
                <ul className="mt-2 space-y-1">
                  {desk.calls.slice(0, 8).map((c) => (
                    <li key={c.id} className="font-mono text-[11px] text-muted">
                      {c.task} · {c.model} · {c.latencyMs}ms · {c.outcome}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

