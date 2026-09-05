import { Link } from "@tanstack/react-router";
import { Shield, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import {
  approveDraft,
  dropDraft,
  loadDesk,
  loadThread,
  markDelivered,
  operatorSend,
  setAutoSend,
  setTakeover,
  simulateInbound,
  simulatePay,
} from "@/lib/agent/fns";
import { UserButton } from "@/lib/auth/gates";
import { cn } from "@/lib/utils";
import { ActivityFeed } from "./activity-feed";
import { FloorSwitch } from "./floor-switch";
import {
  asFloorDesk,
  backgroundRunOf,
  deskActivity,
  latestActivityForThread,
  persistBackgroundRun,
  personaName,
  sortFloorThreads,
  threadAgent,
  type FloorDesk,
  type FloorSnapshot,
  type ScenarioId,
} from "./model";
import { AgentRoster } from "./roster";
import { InboundSimulator } from "./simulator";
import { FloorThreadList } from "./thread-list";
import { ThreadPane } from "./thread-pane";

export function AgentsFloor() {
  const [desk, setDesk] = useState<FloorDesk | null>(null);
  const [thread, setThread] = useState<FloorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [boot, setBoot] = useState(true);
  const [pane, setPane] = useState<"chats" | "thread" | "live">("chats");
  const [narrow, setNarrow] = useState(false);
  const [sim, setSim] = useState("");
  const [compose, setCompose] = useState("");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [localAuto, setLocalAuto] = useState<boolean | null>(null);
  const [localBg, setLocalBg] = useState<boolean | null>(null);
  const bgMissing = useRef(false);
  const threadIdRef = useRef<string | null>(null);
  const deskRef = useRef<FloorDesk | null>(null);
  const autoOpened = useRef(false);

  threadIdRef.current = thread?.thread.id ?? null;
  deskRef.current = desk;

  const applyDesk = useCallback((next: FloorDesk) => {
    setDesk(next);
  }, []);

  const reload = useCallback(async (threadId?: string) => {
    const d = asFloorDesk(await loadDesk());
    applyDesk(d);
    const id = threadId ?? threadIdRef.current;
    if (id) {
      const t = (await loadThread({ data: { threadId: id } })) as FloorSnapshot;
      setThread(t);
    }
  }, [applyDesk]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const tick = async () => {
      try {
        const d = asFloorDesk(await loadDesk());
        if (cancelled) return;
        applyDesk(d);
        setError((prev) => (prev && prev.startsWith("Floor failed") ? null : prev));
        if (!autoOpened.current && !threadIdRef.current && d.threads.length > 0) {
          autoOpened.current = true;
          const top = sortFloorThreads(d.threads)[0];
          if (top) {
            try {
              const t = (await loadThread({ data: { threadId: top.id } })) as FloorSnapshot;
              if (!cancelled) setThread(t);
            } catch {
              /* list still paints */
            }
          }
        }
        const id = threadIdRef.current;
        if (id) {
          try {
            const t = (await loadThread({ data: { threadId: id } })) as FloorSnapshot;
            if (!cancelled) setThread(t);
          } catch {
            if (!cancelled) setThread(null);
          }
        }
      } catch (e) {
        if (!cancelled && !deskRef.current) {
          setError(e instanceof Error ? e.message : "Floor failed to load.");
        }
      } finally {
        if (!cancelled) {
          setBoot(false);
          timer = window.setTimeout(() => void tick(), 3000);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyDesk]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  async function openThread(id: string) {
    setError(null);
    try {
      const t = (await loadThread({ data: { threadId: id } })) as FloorSnapshot;
      setThread(t);
      setCompose("");
      if (narrow) setPane("thread");
      const d = asFloorDesk(await loadDesk());
      applyDesk(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open thread.");
    }
  }

  async function run(text: string, scenario?: ScenarioId) {
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
      setError(e instanceof Error ? e.message : "Simulator could not run.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAuto(on: boolean) {
    setBusy(true);
    setLocalAuto(on);
    setError(null);
    try {
      await setAutoSend({ data: { on } });
      await reload();
      setLocalAuto(null);
    } catch (e) {
      setLocalAuto(null);
      setError(e instanceof Error ? e.message : "Could not change auto-send.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleBackground(on: boolean) {
    setBusy(true);
    setLocalBg(on);
    setError(null);
    try {
      const result = await persistBackgroundRun(on);
      if (result === "missing") {
        bgMissing.current = true;
        setBusy(false);
        return;
      }
      await reload();
      if (!bgMissing.current) setLocalBg(null);
    } catch (e) {
      setLocalBg(null);
      setError(e instanceof Error ? e.message : "Could not change background run.");
    } finally {
      setBusy(false);
    }
  }

  const selected = thread?.thread.id ?? null;
  const name = threadAgent(thread?.thread) || personaName(desk);
  const autoSend = localAuto ?? Boolean(desk?.persona.autoSend);
  const backgroundRun = localBg ?? backgroundRunOf(desk);
  const live = autoSend;
  const autoAllowed = Boolean(desk?.eval.autoSendAllowed);
  const typing =
    latestActivityForThread(desk ? deskActivity(desk) : [], selected)?.kind === "typing";

  return (
    <div id="main" className="flex h-dvh min-w-0 flex-col overflow-hidden bg-bg text-fg">
      <header className="shrink-0 border-b border-border bg-bg [padding-top:env(safe-area-inset-top)]">
        <div className="flex min-h-12 min-w-0 items-center gap-2 px-3">
          <Link to="/" className="shrink-0" aria-label="Home">
            <Logo className="size-7" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="flex min-w-0 items-center gap-2 truncate text-sm font-medium tracking-tight md:text-base">
              {boot && !desk ? "Floor" : name}
              <LivePulse on={Boolean(desk) && (live || typing)} />
            </h1>
            <p className="truncate font-mono text-xs uppercase tracking-widest text-subtle">
              {thread
                ? `${name} · ${thread.thread.fanName}`
                : desk
                  ? desk.persona.clockLabel
                  : boot
                    ? "loading"
                    : "offline"}
              {desk?.persona.quiet ? " · quiet hours" : ""}
            </p>
          </div>
          <EvalChip passed={desk?.eval.passed ?? 0} total={desk?.eval.total ?? 0} />
          <div className="hidden items-center md:flex">
            <FloorSwitch
              label="Auto-send"
              checked={autoSend}
              disabled={busy || (!autoAllowed && !autoSend)}
              title={
                autoAllowed
                  ? "Rapport, aftercare, and check-ins send themselves"
                  : "Gold eval has to pass first"
              }
              onChange={(on) => void toggleAuto(on)}
            />
            <FloorSwitch
              label="Keep running"
              checked={backgroundRun}
              disabled={busy}
              title="The desk keeps pulling and sending after you close this tab"
              onChange={(on) => void toggleBackground(on)}
            />
          </div>
          <UserButton />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto px-2 pb-2 md:hidden">
          <FloorSwitch
            label="Auto-send"
            checked={autoSend}
            disabled={busy || (!autoAllowed && !autoSend)}
            title={
              autoAllowed
                ? "Rapport, aftercare, and check-ins send themselves"
                : "Gold eval has to pass first"
            }
            onChange={(on) => void toggleAuto(on)}
          />
          <FloorSwitch
            label="Keep running"
            checked={backgroundRun}
            disabled={busy}
            title="The desk keeps pulling and sending after you close this tab"
            onChange={(on) => void toggleBackground(on)}
          />
        </div>
      </header>

      {error ? (
        <div className="flex items-center justify-between gap-3 border-b border-down/30 bg-down/10 px-3 py-2 text-sm text-down">
          <p>{error}</p>
          <button
            type="button"
            className="grid size-11 min-h-[44px] min-w-[44px] place-items-center"
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {narrow ? (
        <nav className="flex border-b border-border" aria-label="Floor">
          {(["chats", "thread", "live"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPane(id)}
              aria-current={pane === id ? "page" : undefined}
              className={cn(
                "h-11 min-h-[44px] flex-1 text-sm font-medium capitalize",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/40",
                pane === id ? "text-fg" : "text-muted",
              )}
            >
              {id === "live" ? "Live" : id === "thread" ? "Thread" : "Chats"}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1">
        <aside
          className={cn(
            "hidden w-52 shrink-0 flex-col border-r border-border bg-surface xl:flex",
            "min-h-0",
            narrow && "hidden",
          )}
        >
          <div className="flex h-14 items-center border-b border-border px-4">
            <p className="font-mono text-xs uppercase tracking-widest text-subtle">Agents</p>
          </div>
          {desk ? (
            <AgentRoster desk={desk} selected={agentFilter} onSelect={setAgentFilter} />
          ) : (
            <div className="space-y-2 p-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton-shimmer h-14 rounded-lg" />
              ))}
            </div>
          )}
        </aside>

        <aside
          className={cn(
            "flex min-h-0 w-full shrink-0 flex-col border-r border-border bg-surface lg:w-80",
            narrow && pane !== "chats" && "hidden",
          )}
        >
          {desk ? (
            <div className="border-b border-border xl:hidden">
              <AgentRoster desk={desk} selected={agentFilter} onSelect={setAgentFilter} compact />
            </div>
          ) : null}
          <FloorThreadList
            desk={desk}
            selected={selected}
            agentFilter={agentFilter}
            onOpen={(id) => void openThread(id)}
          />
          <InboundSimulator
            value={sim}
            onChange={setSim}
            busy={busy}
            onSend={() => void run(sim)}
            onScenario={(id) => void run("", id)}
          />
        </aside>

        <section
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            narrow && pane !== "thread" && "hidden",
          )}
        >
          <ThreadPane
            desk={desk}
            snapshot={thread}
            compose={compose}
            onCompose={setCompose}
            busy={busy}
            typing={typing}
            sending={sending}
            showBack={narrow}
            autoSend={autoSend}
            backgroundRun={backgroundRun}
            onBack={() => setPane("chats")}
            onApprove={async (id, body) => {
              setBusy(true);
              try {
                await approveDraft({ data: { messageId: id, body } });
                await reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not approve draft.");
              } finally {
                setBusy(false);
              }
            }}
            onDrop={async (id) => {
              setBusy(true);
              try {
                await dropDraft({ data: { messageId: id } });
                await reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not drop draft.");
              } finally {
                setBusy(false);
              }
            }}
            onTakeover={async (on) => {
              if (!thread) return;
              setBusy(true);
              try {
                await setTakeover({ data: { threadId: thread.thread.id, on } });
                await reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not change takeover.");
              } finally {
                setBusy(false);
              }
            }}
            onSend={async () => {
              if (!thread || !compose.trim()) return;
              setBusy(true);
              setSending(true);
              try {
                await operatorSend({ data: { threadId: thread.thread.id, body: compose } });
                setCompose("");
                await reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not send.");
              } finally {
                setSending(false);
                setBusy(false);
              }
            }}
          />
        </section>

        <aside
          className={cn(
            "flex min-h-0 w-full shrink-0 flex-col border-l border-border bg-bg lg:w-80",
            narrow && pane !== "live" && "hidden",
            !narrow && "hidden lg:flex",
          )}
        >
          <ActivityFeed
            desk={desk}
            snapshot={thread}
            onOpen={(id) => void openThread(id)}
            onPay={async (id) => {
              try {
                await simulatePay({ data: { offerId: id } });
                await reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not mark paid.");
              }
            }}
            onDeliver={async (id) => {
              try {
                await markDelivered({ data: { offerId: id } });
                await reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not mark delivered.");
              }
            }}
          />
        </aside>
      </div>
    </div>
  );
}

function LivePulse({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-label="Live">
      <span className="floor-live-dot absolute inset-0 rounded-full bg-up" />
      <span className="relative size-2 rounded-full bg-up" />
    </span>
  );
}

function EvalChip({ passed, total }: { passed: number; total: number }) {
  const ok = total > 0 && passed === total;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs uppercase tracking-widest",
        ok ? "border-up/40 text-up" : "border-warn/40 text-warn",
      )}
    >
      <Shield className="size-3.5" />
      eval {passed}/{total}
    </span>
  );
}
