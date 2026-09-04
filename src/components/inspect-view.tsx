import { Archive, LoaderCircle, Plus, Radio, Search, TrendingUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BriefPanel } from "@/components/brief-panel";
import { CommandBar } from "@/components/command-bar";
import { ProfileCard, TweetCard } from "@/components/tweet-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { runProfilePostsFn, runRelayFn, runThreadRepliesFn, runTrendsFn } from "@/lib/research";
import { sortByEngagement, sortByNewest } from "@/lib/x/format";
import type { SearchFilters, Tweet } from "@/lib/x/types";
import { cn, formatCount } from "@/lib/utils";
import { useRelay, type Tab } from "@/store/relay";
import { useStudio } from "@/store/studio";

const EXAMPLES = [
  { label: "Grok on X", q: "Grok AI" },
  { label: "Open a profile", q: "@elonmusk" },
  { label: "A famous post", q: "https://x.com/jack/status/20" },
];

export function InspectView() {
  const tab = useRelay((s) => s.tab);
  const setTab = useRelay((s) => s.setTab);
  const setQuery = useRelay((s) => s.setQuery);
  const product = useRelay((s) => s.product);
  const sort = useRelay((s) => s.sort);
  const setSort = useRelay((s) => s.setSort);
  const minFaves = useRelay((s) => s.minFaves);
  const loading = useRelay((s) => s.loading);
  const setLoading = useRelay((s) => s.setLoading);
  const error = useRelay((s) => s.error);
  const hint = useRelay((s) => s.hint);
  const setError = useRelay((s) => s.setError);
  const result = useRelay((s) => s.result);
  const setResult = useRelay((s) => s.setResult);
  const remember = useRelay((s) => s.remember);
  const archive = useRelay((s) => s.archive);
  const [mobileBrief, setMobileBrief] = useState(false);
  const [followup, setFollowup] = useState(false);

  async function run(raw: string, nextTab: Tab = "search") {
    const q = raw.trim();
    if (!q && nextTab !== "trends") return;
    setTab(nextTab);
    setLoading(true);
    setError(null);
    if (q) {
      setQuery(q);
      remember(q);
    }
    try {
      if (nextTab === "trends") {
        const res = await runTrendsFn({ data: {} });
        if (!res.ok) setError(res.error, res.hint);
        else setResult(res);
        return;
      }
      const filters: SearchFilters = {};
      if (minFaves > 0) filters.minFaves = minFaves;
      const res = await runRelayFn({ data: { q, product, filters } });
      if (!res.ok) setError(res.error, res.hint);
      else {
        setResult(res);
        if (res.kind === "profile") {
          setFollowup(true);
          void runProfilePostsFn({ data: { handle: res.profile.handle } })
            .then((extra) => {
              if (extra.ok) setResult(extra);
            })
            .finally(() => setFollowup(false));
        } else if (res.kind === "thread" && (res.thread.claimedCount ?? 0) > 0) {
          setFollowup(true);
          void runThreadRepliesFn({ data: { id: res.thread.root.id } })
            .then((extra) => {
              if (extra.ok) setResult(extra);
            })
            .finally(() => setFollowup(false));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something broke.";
      setError(message, "Try again — live X can stall for a few seconds.");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  const hasResults = Boolean(result) && !error;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <NavTab icon={Search} label="Search" active={tab === "search"} onClick={() => setTab("search")} />
          <NavTab icon={TrendingUp} label="Trends" active={tab === "trends"} onClick={() => run("", "trends")} />
          <NavTab
            icon={Archive}
            label="Archive"
            active={tab === "archive"}
            count={archive.length}
            onClick={() => setTab("archive")}
          />
        </div>

        {tab === "archive" ? (
          <ArchiveView />
        ) : tab === "trends" ? (
          <TrendsView loading={loading} onSearch={(q) => run(q, "search")} />
        ) : (
          <>
            <CommandBar compact={hasResults || loading} onSubmit={(q) => run(q, "search")} />
            {!hasResults && !loading && (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.q}
                    type="button"
                    onClick={() => run(ex.q, "search")}
                    className="rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-2"
                  >
                    <p className="text-sm font-medium text-fg">{ex.label}</p>
                    <p className="mt-1 truncate font-mono text-xs text-muted">{ex.q}</p>
                  </button>
                ))}
              </div>
            )}
            {error && (
              <div className="mt-6 rounded-xl border border-down/30 bg-surface p-5">
                <p className="text-sm font-medium text-fg">{error}</p>
                {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
              </div>
            )}
            {loading && !hasResults && <LoadingState />}
            {loading && hasResults && (
              <p className="mt-4 flex items-center gap-2 text-sm text-muted">
                <LoaderCircle className="size-4 animate-spin" />
                Updating this search…
              </p>
            )}
            {hasResults && result && (
              <section className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
                <div>
                  {followup && (
                    <p className="mb-3 flex items-center gap-2 text-sm text-muted">
                      <LoaderCircle className="size-4 animate-spin" />
                      Fetching the rest of this slice…
                    </p>
                  )}
                  <Results
                    sort={sort}
                    onSort={setSort}
                    onOpenThread={(id) => run(id, "search")}
                    onOpenProfile={(handle) => run(`@${handle}`, "search")}
                  />
                </div>
                <div className="hidden lg:block">
                  <BriefPanel />
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {hasResults && result && result.kind !== "trends" && (
        <div className="fixed inset-x-0 bottom-16 z-20 px-4 lg:hidden">
          {mobileBrief ? (
            <div className="max-h-[70dvh] overflow-y-auto rounded-xl border border-border shadow-2xl">
              <BriefPanel />
              <div className="border-t border-border bg-surface p-3">
                <Button variant="secondary" className="w-full" onClick={() => setMobileBrief(false)}>
                  Close brief
                </Button>
              </div>
            </div>
          ) : (
            <Button className="w-full shadow-lg" onClick={() => setMobileBrief(true)}>
              Brief this
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function NavTab({
  icon: Icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: typeof Search;
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm transition-[color,background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
        active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
      )}
    >
      <Icon className="size-4" />
      {label}
      {typeof count === "number" && count > 0 && (
        <span className="font-mono text-xs tabular-nums text-subtle">{count}</span>
      )}
    </button>
  );
}

function LoadingState() {
  return (
    <div className="mt-8 grid gap-3">
      <div className="flex items-center gap-2 text-sm text-muted">
        <LoaderCircle className="size-4 animate-spin" />
        Searching live X — this can take a few seconds.
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}

function Results({
  sort,
  onSort,
  onOpenThread,
  onOpenProfile,
}: {
  sort: "engagement" | "newest";
  onSort: (s: "engagement" | "newest") => void;
  onOpenThread: (id: string) => void;
  onOpenProfile: (handle: string) => void;
}) {
  const result = useRelay((s) => s.result);
  if (!result) return null;

  if (result.kind === "people") {
    return (
      <div>
        <HeaderLine kicker="People" title={result.query} note={result.note} live={result.live} count={result.users.length} />
        <div className="mt-4 grid gap-3">
          {result.users.map((u) => (
            <div key={u.id || u.handle} className="relative">
              <ProfileCard profile={u} onOpen={onOpenProfile} />
              <AssignChip handle={u.handle} />
            </div>
          ))}
          {result.users.length === 0 && <EmptySlice />}
        </div>
      </div>
    );
  }

  if (result.kind === "profile") {
    const p = result.profile;
    return (
      <div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {p.banner && (
            <img src={p.banner} alt="" className="h-28 w-full object-cover sm:h-36" referrerPolicy="no-referrer" />
          )}
          <div className="p-5">
            <div className="flex items-end gap-4">
              <span className="-mt-10 size-16 overflow-hidden rounded-full border-2 border-surface bg-surface-2 sm:size-20">
                {p.avatar && (
                  <img src={p.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                )}
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <h2 className="truncate text-xl font-medium">{p.name}</h2>
                <p className="font-mono text-sm text-muted">@{p.handle}</p>
              </div>
              <AssignButton handle={p.handle} />
            </div>
            {p.bio && <p className="mt-3 text-sm leading-relaxed text-fg">{p.bio}</p>}
            <div className="mt-4 flex flex-wrap gap-4 font-mono text-xs tabular-nums text-muted">
              <span>
                <strong className="text-fg">{formatCount(p.followers)}</strong> followers
              </span>
              <span>
                <strong className="text-fg">{formatCount(p.following)}</strong> following
              </span>
              <span>
                <strong className="text-fg">{formatCount(p.tweets)}</strong> posts
              </span>
            </div>
          </div>
        </div>
        {result.note && <p className="mt-3 text-sm text-muted">{result.note}</p>}
        <div className="mt-4 grid gap-3">
          {ordered(result.tweets, sort).map((t) => (
            <TweetCard key={t.id} tweet={t} onOpenThread={onOpenThread} onOpenProfile={onOpenProfile} />
          ))}
        </div>
      </div>
    );
  }

  if (result.kind === "thread") {
    const th = result.thread;
    return (
      <div>
        <HeaderLine
          kicker="Thread"
          title={`@${th.root.author.handle}`}
          note={th.warning}
          live={result.live}
          count={th.returnedCount}
        />
        <div className="mt-4 grid gap-3">
          <TweetCard tweet={th.root} featured onOpenThread={onOpenThread} onOpenProfile={onOpenProfile} />
          {th.replies.map((t) => (
            <TweetCard key={t.id} tweet={t} onOpenThread={onOpenThread} onOpenProfile={onOpenProfile} />
          ))}
        </div>
      </div>
    );
  }

  if (result.kind !== "search") return null;
  const tweets = ordered(result.tweets, sort);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <HeaderLine kicker={result.product} title={result.query} note={result.note} live={result.live} count={tweets.length} />
        <div className="flex rounded-full border border-border bg-surface p-0.5">
          {(["engagement", "newest"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSort(s)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-medium capitalize",
                sort === s ? "bg-fg text-bg" : "text-muted",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {tweets.map((t) => (
          <TweetCard key={t.id} tweet={t} onOpenThread={onOpenThread} onOpenProfile={onOpenProfile} />
        ))}
        {tweets.length === 0 && <EmptySlice />}
      </div>
    </div>
  );
}

function AssignButton({ handle }: { handle: string }) {
  const publisher = useStudio((s) => s.publishers.find((p) => p.id === s.selectedPublisherId) ?? s.publishers[0]);
  const assigning = useStudio((s) => s.adding);
  const addHandles = useStudio((s) => s.addHandles);
  if (!publisher) return null;
  return (
    <Button
      size="sm"
      className="shrink-0"
      disabled={assigning}
      onClick={() => void addHandles([handle])}
    >
      <Plus className="size-4" />
      Assign to @{publisher.handle}
    </Button>
  );
}

function AssignChip({ handle }: { handle: string }) {
  const publisher = useStudio((s) => s.publishers.find((p) => p.id === s.selectedPublisherId) ?? s.publishers[0]);
  const addHandles = useStudio((s) => s.addHandles);
  const assigning = useStudio((s) => s.adding);
  if (!publisher) return null;
  return (
    <button
      type="button"
      disabled={assigning}
      onClick={(e) => {
        e.stopPropagation();
        void addHandles([handle]);
      }}
      className="absolute right-3 top-3 rounded-full border border-border bg-bg/90 px-2.5 py-1 text-xs text-muted hover:text-fg"
    >
      Assign
    </button>
  );
}

function HeaderLine({
  kicker,
  title,
  note,
  live,
  count,
}: {
  kicker: string;
  title: string;
  note?: string;
  live?: boolean;
  count?: number;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-subtle">
        {kicker}
        {live && (
          <span className="inline-flex items-center gap-1 normal-case tracking-normal text-muted">
            <Radio className="size-3" />
            live
          </span>
        )}
        {typeof count === "number" && <span className="tabular-nums text-subtle">{count}</span>}
      </p>
      <h2 className="mt-1 truncate text-xl font-medium tracking-tight">{title}</h2>
      {note && <p className="mt-1 max-w-xl text-sm text-muted">{note}</p>}
    </div>
  );
}

function ordered(tweets: Tweet[], sort: "engagement" | "newest") {
  return sort === "newest" ? sortByNewest(tweets) : sortByEngagement(tweets);
}

function EmptySlice() {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="text-sm text-muted">Nothing in this slice. Try Latest, or drop the like filter.</p>
    </div>
  );
}

function TrendsView({ loading, onSearch }: { loading: boolean; onSearch: (q: string) => void }) {
  const result = useRelay((s) => s.result);
  const error = useRelay((s) => s.error);

  return (
    <section>
      <p className="font-mono text-xs uppercase tracking-widest text-subtle">Now</p>
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Trends on X</h1>
      {loading && <LoadingState />}
      {error && <p className="mt-6 text-sm text-down">{error}</p>}
      {result?.kind === "trends" && (
        <ol className="mt-8 divide-y divide-border rounded-xl border border-border bg-surface">
          {result.trends.map((t, i) => (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => onSearch(t.name)}
                className="flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-surface-2"
              >
                <span className="w-6 font-mono text-sm tabular-nums text-subtle">{t.rank ?? i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{t.name}</span>
                  {t.context && <span className="mt-1 block text-sm text-muted">{t.context}</span>}
                </span>
                {t.volume && <span className="font-mono text-xs tabular-nums text-subtle">{t.volume}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ArchiveView() {
  const archive = useRelay((s) => s.archive);
  const setQuery = useRelay((s) => s.setQuery);
  const setTab = useRelay((s) => s.setTab);

  function exportJson() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schema: "x-relay/archive@1",
            source: "bookmarks",
            generatedAt: new Date().toISOString(),
            count: archive.length,
            tweets: archive,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "x-relay-archive.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-subtle">Saved</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight">Archive</h1>
        </div>
        {archive.length > 0 && (
          <Button variant="secondary" onClick={exportJson}>
            Export JSON
          </Button>
        )}
      </div>
      {archive.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted">Nothing saved yet. Open a post and tap the bookmark.</p>
        </div>
      ) : (
        <div className="mt-8 grid gap-3">
          {archive.map((t) => (
            <TweetCard
              key={t.id}
              tweet={t}
              onOpenThread={(id) => {
                setQuery(id);
                setTab("search");
              }}
              onOpenProfile={(handle) => {
                setQuery(`@${handle}`);
                setTab("search");
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
