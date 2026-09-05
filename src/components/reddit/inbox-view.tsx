import { formatDistanceToNow } from "date-fns";
import { Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import type { InboxSnapshot, RedditThread } from "@/lib/reddit/types";
import { loadInbox } from "@/lib/reddit/server";
import { cn } from "@/lib/utils";

export function InboxView({ accountId }: { accountId: string }) {
  const [data, setData] = useState<InboxSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    setActive(null);
    void loadInbox({ data: { accountId } })
      .then((snap) => {
        if (!alive) return;
        setData(snap);
        setActive(snap.threads[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Could not load inbox.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const thread = data?.threads.find((t) => t.id === active) ?? null;

  if (loading) {
    return (
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(16rem,22rem)_1fr]">
        <div className="space-y-2 border-b border-line p-4 md:border-r md:border-b-0">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-lift" />
          ))}
        </div>
        <div className="hidden md:block" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-bad">
        {error}
      </div>
    );
  }

  if (!data || data.threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <Inbox className="size-8 text-subtle" />
        <p className="text-sm text-muted">Inbox is empty. That’s the real inbox, not a sample.</p>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(16rem,22rem)_1fr]">
      <ul className={cn("min-h-0 overflow-y-auto border-line md:border-r", thread ? "hidden md:block" : "block")}>
        {data.threads.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setActive(t.id)}
              className={cn(
                "w-full border-b border-line px-4 py-3.5 text-left transition-colors duration-150",
                t.id === active ? "bg-lift" : "hover:bg-lift/60",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium">
                  {t.unread > 0 ? <span className="mr-2 inline-block size-1.5 rounded-full bg-accent" /> : null}
                  {t.subject}
                </p>
                <span className="shrink-0 font-mono text-[11px] text-subtle">
                  {rel(t.latestUtc)}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-muted">
                {t.wasComment && t.subreddit ? `r/${t.subreddit} · ` : null}
                {t.participants.filter(Boolean).slice(0, 3).join(", ")}
              </p>
            </button>
          </li>
        ))}
      </ul>
      <article className={cn("min-h-0 overflow-y-auto", thread ? "block" : "hidden md:block")}>
        {thread ? (
          <Thread thread={thread} onBack={() => setActive(null)} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-subtle">
            Choose a thread
          </div>
        )}
      </article>
    </div>
  );
}

function Thread({ thread, onBack }: { thread: RedditThread; onBack: () => void }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur-sm">
        <button
          type="button"
          className="mb-2 text-xs text-muted md:hidden"
          onClick={onBack}
        >
          Back to inbox
        </button>
        <h2 className="text-base font-medium tracking-tight">{thread.subject}</h2>
        <p className="mt-1 font-mono text-[11px] text-subtle">
          {thread.wasComment ? "Comment replies" : "Private messages"}
          {thread.subreddit ? ` · r/${thread.subreddit}` : ""}
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-4 px-4 py-5">
        {thread.messages.map((m) => (
          <div key={m.fullname || m.id} className="rounded-lg bg-card px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">
                {m.author}
                {m.isNew ? (
                  <span className="ml-2 font-mono text-[10px] tracking-wider text-accent uppercase">
                    new
                  </span>
                ) : null}
              </p>
              <span className="font-mono text-[11px] text-subtle">{rel(m.createdUtc)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {m.body || "(empty)"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function rel(utc: number) {
  if (!utc) return "";
  try {
    return formatDistanceToNow(new Date(utc * 1000), { addSuffix: true });
  } catch {
    return "";
  }
}
