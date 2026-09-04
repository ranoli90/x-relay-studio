import { ArrowLeft, Copy, ExternalLink, Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { StoredPost } from "@/lib/studio/types";
import { cn, formatCount } from "@/lib/utils";
import { useStudio } from "@/store/studio";

export function SourceDetail() {
  const sourceId = useStudio((s) => s.selectedSourceId);
  const source = useStudio((s) => s.sources.find((x) => x.id === sourceId));
  const publisher = useStudio((s) => s.publishers.find((p) => p.id === source?.publisherId));
  const posts = useStudio((s) => s.posts);
  const postsTotal = useStudio((s) => s.postsTotal);
  const postsLoading = useStudio((s) => s.postsLoading);
  const loadPosts = useStudio((s) => s.loadPosts);
  const selectSource = useStudio((s) => s.selectSource);
  const retry = useStudio((s) => s.retry);
  const [pane, setPane] = useState<"posts" | "media" | "voice">("posts");

  useEffect(() => {
    if (sourceId) void loadPosts(sourceId, 0);
  }, [sourceId, loadPosts]);

  if (!source) return null;

  const media = posts.flatMap((p) => p.media.map((m) => ({ ...m, post: p })));

  async function copyRewrites() {
    const lines = posts
      .filter((p) => p.rewriteText)
      .map((p) => p.rewriteText)
      .join("\n\n");
    if (!lines) {
      toast.error("No rewrites yet.");
      return;
    }
    await navigator.clipboard.writeText(lines);
    toast.success("Rewrites copied.");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => selectSource(null)}
          className="inline-flex h-10 items-center gap-2 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          All sources
        </button>
        <div className="mt-3 flex items-start gap-3">
          <span className="size-12 shrink-0 overflow-hidden rounded-full bg-surface-2">
            {source.avatar && (
              <img src={source.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-medium">{source.name}</h2>
            <p className="font-mono text-sm text-muted">@{source.handle}</p>
            <p className="mt-2 font-mono text-xs tabular-nums text-subtle">
              {formatCount(source.tweetsSynced)} stored
              {source.tweetsClaimed > 0 && ` of ~${formatCount(source.tweetsClaimed)}`}
              {" · "}
              {formatCount(source.mediaSynced)} images
              {" · "}
              {formatCount(source.rewritten)} rewritten for @{publisher?.handle}
            </p>
            {source.error && (
              <p className="mt-2 text-sm text-down">
                {source.error}{" "}
                <button type="button" className="underline" onClick={() => void retry(source.id)}>
                  Retry
                </button>
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["posts", "media", "voice"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPane(p)}
              className={cn(
                "h-11 rounded-full px-4 text-sm capitalize transition-[color,background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
                pane === p ? "bg-fg text-bg" : "text-muted hover:text-fg",
              )}
            >
              {p}
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void copyRewrites()}>
              <Copy className="size-4" />
              Copy rewrites
            </Button>
          </div>
        </div>
      </div>

      <div key={pane} className="page-enter min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {pane === "voice" && (
          <div className="max-w-2xl">
            <p className="text-sm text-muted">
              OpenRouter writes a voice from the full stored set, then uses it for every
              rewrite on @{publisher?.handle}. Images stay as stored URLs — we don’t
              re-download binaries.
            </p>
            {source.voice ? (
              <div className="mt-4 rounded-xl border border-border bg-surface p-5">
                <p className="text-sm leading-relaxed text-fg">{source.voice.voice}</p>
                {source.voice.topics.length > 0 && (
                  <p className="mt-3 text-sm text-muted">{source.voice.topics.join(" · ")}</p>
                )}
                {source.voice.bio && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="font-mono text-xs uppercase tracking-widest text-subtle">Suggested bio</p>
                    <p className="mt-2 text-sm">{source.voice.bio}</p>
                  </div>
                )}
                {source.voice.pinned && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="font-mono text-xs uppercase tracking-widest text-subtle">Suggested pin</p>
                    <p className="mt-2 text-sm">{source.voice.pinned}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">Voice lands after the first posts are stored.</p>
            )}
          </div>
        )}

        {pane === "media" && (
          <div>
            <p className="mb-4 text-sm text-muted">
              Every image and video URL from the archive, kept next to the post it came from.
            </p>
            {media.length === 0 ? (
              <p className="text-sm text-muted">No media in the stored slice yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {media.map((m) => (
                  <a
                    key={m.url}
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative overflow-hidden rounded-lg bg-surface-2"
                  >
                    <img
                      src={m.thumbnail ?? m.url}
                      alt=""
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <span className="absolute bottom-1 left-1 rounded bg-bg/80 px-1.5 py-0.5 font-mono text-xs text-muted">
                      {m.type}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {pane === "posts" && (
          <div className="grid gap-3">
            {postsLoading && posts.length === 0 && (
              <>
                <Skeleton className="h-32 rounded-xl" />
                <Skeleton className="h-32 rounded-xl" />
              </>
            )}
            {posts.map((post) => (
              <PostPair key={post.id} post={post} publisher={publisher?.handle ?? ""} />
            ))}
            {posts.length === 0 && !postsLoading && (
              <p className="text-sm text-muted">
                {source.status === "pending" || source.status === "syncing"
                  ? "Pulling the full archive. Posts appear here as they land."
                  : "No posts stored yet."}
              </p>
            )}
            {posts.length < postsTotal && (
              <Button
                variant="secondary"
                disabled={postsLoading}
                onClick={() => void loadPosts(source.id, posts.length)}
              >
                Load more ({posts.length} of {postsTotal})
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PostPair({ post, publisher }: { post: StoredPost; publisher: string }) {
  return (
    <article className="grid gap-0 overflow-hidden rounded-xl border border-border bg-surface md:grid-cols-2">
      <div className="border-b border-border p-4 md:border-b-0 md:border-r">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">Original</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg">{post.text || "—"}</p>
        {post.media.length > 0 && (
          <div className={cn("mt-3 grid gap-1", post.media.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {post.media.slice(0, 4).map((m) => (
              <img
                key={m.url}
                src={m.thumbnail ?? m.url}
                alt=""
                className="max-h-40 w-full rounded-md object-cover"
                referrerPolicy="no-referrer"
              />
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-3 font-mono text-xs text-subtle">
          {post.createdAt && <span>{post.createdAt.slice(0, 10)}</span>}
          {post.media.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="size-3" />
              {post.media.length}
            </span>
          )}
          {post.url && (
            <a href={post.url} target="_blank" rel="noreferrer" className="hover:text-fg">
              Source
            </a>
          )}
        </div>
      </div>
      <div className="p-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle">For @{publisher}</p>
        {post.rewriteText ? (
          <>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg">{post.rewriteText}</p>
            <div className="mt-3 flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={async () => {
                  await navigator.clipboard.writeText(post.rewriteText ?? "");
                  toast.success("Copied");
                }}
              >
                <Copy className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => {
                  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(post.rewriteText ?? "")}`;
                  window.open(url, "_blank", "noopener");
                }}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {post.rewriteStatus === "skipped"
              ? "Stored, not rewritten (repost or empty)."
              : "Waiting in the rewrite queue."}
          </p>
        )}
      </div>
    </article>
  );
}
