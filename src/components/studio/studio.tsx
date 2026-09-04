import { Download, Plus, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { InspectView } from "@/components/inspect-view";
import { Logo } from "@/components/logo";
import { ConnectPublisher } from "@/components/studio/connect-publisher";
import { SourceDetail } from "@/components/studio/source-detail";
import { SourceWorkspace } from "@/components/studio/source-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { cn, formatCount } from "@/lib/utils";
import { useStudio } from "@/store/studio";

export function Studio() {
  const loading = useStudio((s) => s.loading);
  const refresh = useStudio((s) => s.refresh);
  const pump = useStudio((s) => s.pump);
  const publishers = useStudio((s) => s.publishers);
  const tab = useStudio((s) => s.tab);
  const selectedSourceId = useStudio((s) => s.selectedSourceId);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void pump();
    const id = window.setInterval(() => {
      void pump();
    }, 20_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void pump();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pump]);

  const viewKey = loading
    ? "boot"
    : publishers.length === 0 && tab === "sources"
      ? "connect"
      : tab === "inspect"
        ? "inspect"
        : (selectedSourceId ?? "sources");

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar booting={loading} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header />
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div key={viewKey} className="page-enter flex min-h-0 flex-1 flex-col">
            {loading ? (
              <MainSkeleton />
            ) : publishers.length === 0 && tab === "sources" ? (
              <div className="flex-1 overflow-y-auto px-4">
                <ConnectPublisher />
              </div>
            ) : tab === "inspect" ? (
              <InspectView />
            ) : (
              <SourcesPane />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SourcesPane() {
  const selectedSourceId = useStudio((s) => s.selectedSourceId);
  if (selectedSourceId) return <SourceDetail />;
  return <SourceWorkspace />;
}

function Header() {
  const tab = useStudio((s) => s.tab);
  const setTab = useStudio((s) => s.setTab);
  const sources = useStudio((s) => s.sources);
  const publishers = useStudio((s) => s.publishers);
  const selectedPublisherId = useStudio((s) => s.selectedPublisherId);
  const selectPublisher = useStudio((s) => s.selectPublisher);
  const exportActive = useStudio((s) => s.exportActive);
  const publisher = publishers.find((p) => p.id === selectedPublisherId);
  const queue = useMemo(() => {
    let pulling = 0;
    let rewriting = 0;
    let monitoring = 0;
    let errors = 0;
    let stored = 0;
    let rewritten = 0;
    for (const s of sources) {
      stored += s.tweetsSynced;
      rewritten += s.rewritten;
      if (s.status === "pending" || s.status === "syncing") pulling += 1;
      else if (s.status === "rewriting") rewriting += 1;
      else if (s.status === "ready") monitoring += 1;
      else if (s.status === "error") errors += 1;
    }
    return { pulling, rewriting, monitoring, errors, stored, rewritten };
  }, [sources]);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
      <div className="flex items-center gap-2 sm:hidden">
        <Logo className="size-7" />
      </div>
      {publishers.length > 0 && (
        <label className="min-w-0 sm:hidden">
          <span className="sr-only">Posting account</span>
          <select
            className="h-11 max-w-36 truncate rounded-md border border-border bg-bg px-2 font-mono text-sm text-fg"
            value={selectedPublisherId ?? ""}
            onChange={(e) => {
              selectPublisher(e.target.value);
              setTab("sources");
            }}
          >
            {publishers.map((p) => (
              <option key={p.id} value={p.id}>
                @{p.handle}
              </option>
            ))}
          </select>
        </label>
      )}
      <nav className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setTab("sources")}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm transition-[color,background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
            tab === "sources" ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
          )}
        >
          <Users className="size-4" />
          <span className="hidden sm:inline">Sources</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("inspect")}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm transition-[color,background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
            tab === "inspect" ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
          )}
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">Inspect</span>
        </button>
      </nav>
      {sources.length > 0 && (
        <p className="hidden min-w-0 truncate font-mono text-xs tabular-nums text-muted md:block">
          {queue.pulling > 0 && `${queue.pulling} pulling · `}
          {queue.rewriting > 0 && `${queue.rewriting} rewrite · `}
          {queue.monitoring > 0 && `${queue.monitoring} live · `}
          {queue.errors > 0 && `${queue.errors} retry · `}
          {formatCount(queue.stored)} stored
          {queue.rewritten > 0 && ` · ${formatCount(queue.rewritten)} ready`}
        </p>
      )}
      <div className="ml-auto flex items-center gap-2">
        {publisher && tab === "sources" && (
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => void exportActive()}>
            <Download className="size-4" />
            Export set
          </Button>
        )}
        <UserChip />
      </div>
    </header>
  );
}

function UserChip() {
  const { user, isPending } = useCurrentUserState();
  return (
    <div className="flex h-8 min-w-8 items-center [&_span.text-sm]:hidden sm:[&_span.text-sm]:inline [&_button]:text-muted [&_button]:no-underline hover:[&_button]:text-fg">
      {isPending && !user ? <Skeleton className="size-8 rounded-full" /> : <UserButton />}
    </div>
  );
}

function Sidebar({ booting }: { booting: boolean }) {
  const publishers = useStudio((s) => s.publishers);
  const selectedPublisherId = useStudio((s) => s.selectedPublisherId);
  const selectPublisher = useStudio((s) => s.selectPublisher);
  const sources = useStudio((s) => s.sources);
  const setTab = useStudio((s) => s.setTab);
  const [adding, setAdding] = useState(false);
  const removePublisher = useStudio((s) => s.removePublisher);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-bg sm:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Logo className="size-7" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">X Relay</p>
          <p className="truncate font-mono text-xs text-subtle">Studio</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <p className="px-2 pb-2 font-mono text-xs uppercase tracking-widest text-subtle">Posting as</p>
        {booting && publishers.length === 0 ? (
          <ul className="grid gap-1">
            <li className="flex items-center gap-2 rounded-lg px-2 py-2">
              <Skeleton className="size-8 rounded-full" />
              <span className="grid flex-1 gap-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2 w-16" />
              </span>
            </li>
            <li className="flex items-center gap-2 rounded-lg px-2 py-2">
              <Skeleton className="size-8 rounded-full" />
              <span className="grid flex-1 gap-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2 w-12" />
              </span>
            </li>
          </ul>
        ) : (
          <ul className="grid gap-1">
            {publishers.map((p) => {
              const count = sources.filter((s) => s.publisherId === p.id).length;
              const active = p.id === selectedPublisherId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      selectPublisher(p.id);
                      setTab("sources");
                      setAdding(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-[background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
                      active ? "bg-surface-2" : "hover:bg-surface",
                    )}
                  >
                    <span className="size-8 overflow-hidden rounded-full bg-surface-2">
                      {p.avatar ? (
                        <img src={p.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-xs">{p.handle.slice(0, 1).toUpperCase()}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">@{p.handle}</span>
                      <span className="block font-mono text-xs tabular-nums text-subtle">
                        {formatCount(count)} sources
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {adding ? (
          <div className="mt-3">
            <ConnectPublisher compact />
            <button
              type="button"
              className="mt-2 h-10 w-full text-center text-xs text-muted hover:text-fg"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted transition-[background-color,color] duration-[var(--motion-quick)] ease-[var(--ease-out)] hover:bg-surface hover:text-fg"
          >
            <Plus className="size-4" />
            Add posting account
          </button>
        )}
        {publishers.length > 1 && selectedPublisherId && (
          <button
            type="button"
            className="mt-auto px-2 py-3 text-left text-xs text-subtle hover:text-down"
            onClick={() => {
              if (window.confirm("Remove this posting account and its assigned sources?")) {
                void removePublisher(selectedPublisherId);
              }
            }}
          >
            Remove posting account
          </button>
        )}
      </div>
    </aside>
  );
}

function MainSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-md" />
        <Skeleton className="mt-4 h-24 w-full rounded-md" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-11 w-32 rounded-md" />
          <Skeleton className="h-4 w-40 self-center" />
        </div>
      </div>
      <div className="min-h-0 flex-1 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-3 border-b border-border py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="grid flex-1 gap-1">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-2 w-24" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex items-center gap-3 border-b border-border py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="grid flex-1 gap-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-2 w-20" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
        <div className="flex items-center gap-3 border-b border-border py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="grid flex-1 gap-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2 w-16" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}
