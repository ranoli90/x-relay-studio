import { formatDistanceToNowStrict } from "date-fns";
import {
  Bookmark,
  BookmarkCheck,
  Copy,
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Tweet } from "@/lib/x/types";
import { cn, formatCount } from "@/lib/utils";
import { useRelay } from "@/store/relay";

function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return null;
  }
}

export function TweetCard({
  tweet,
  featured = false,
  onOpenThread,
  onOpenProfile,
}: {
  tweet: Tweet;
  featured?: boolean;
  onOpenThread?: (id: string) => void;
  onOpenProfile?: (handle: string) => void;
}) {
  const saveTweet = useRelay((s) => s.saveTweet);
  const removeTweet = useRelay((s) => s.removeTweet);
  const saved = useRelay((s) => s.archive.some((t) => t.id === tweet.id));
  const when = relativeTime(tweet.createdAt);

  return (
    <article
      className={cn(
        "group rounded-xl border border-border bg-surface p-4 transition-colors duration-[var(--motion-quick)]",
        featured && "p-5",
      )}
    >
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onOpenProfile?.(tweet.author.handle)}
          className="mt-0.5 size-10 shrink-0 overflow-hidden rounded-full bg-surface-2"
          aria-label={`@${tweet.author.handle}`}
        >
          {tweet.author.avatar ? (
            <img
              src={tweet.author.avatar}
              alt=""
              width={40}
              height={40}
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-xs font-medium text-muted">
              {tweet.author.handle.slice(0, 2).toUpperCase()}
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={() => onOpenProfile?.(tweet.author.handle)}
              className="truncate text-sm font-medium text-fg hover:underline"
            >
              {tweet.author.name}
            </button>
            <span className="truncate font-mono text-xs text-muted">@{tweet.author.handle}</span>
            {when && <span className="text-xs text-subtle">{when}</span>}
          </div>
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap text-pretty text-sm leading-relaxed text-fg",
              featured && "text-base",
            )}
          >
            {tweet.text}
          </p>
          {tweet.quoted && (
            <div className="mt-3 rounded-lg border border-border bg-bg p-3">
              <p className="font-mono text-xs text-muted">@{tweet.quoted.author.handle}</p>
              <p className="mt-1 line-clamp-4 text-sm text-fg">{tweet.quoted.text}</p>
            </div>
          )}
          {tweet.mediaItems && tweet.mediaItems.length > 0 && (
            <div
              className={cn(
                "mt-3 grid gap-1 overflow-hidden rounded-lg",
                tweet.mediaItems.length === 1 ? "grid-cols-1" : "grid-cols-2",
              )}
            >
              {tweet.mediaItems.slice(0, 4).map((m) => (
                <img
                  key={m.url}
                  src={m.thumbnail ?? m.url}
                  alt=""
                  className="max-h-72 w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs tabular-nums text-muted">
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3.5" />
              {formatCount(tweet.metrics.likes)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Repeat2 className="size-3.5" />
              {formatCount(tweet.metrics.retweets)}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3.5" />
              {formatCount(tweet.metrics.replies)}
            </span>
            {tweet.metrics.views != null && (
              <span className="inline-flex items-center gap-1">
                <Eye className="size-3.5" />
                {formatCount(tweet.metrics.views)}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => onOpenThread?.(tweet.id)}
              >
                Thread
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={async () => {
                  await navigator.clipboard.writeText(tweet.url);
                  toast.success("Link copied");
                }}
                aria-label="Copy link"
              >
                <Copy className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => {
                  if (saved) removeTweet(tweet.id);
                  else {
                    saveTweet(tweet);
                    toast.success("Saved to archive");
                  }
                }}
                aria-label={saved ? "Remove from archive" : "Save to archive"}
              >
                {saved ? (
                  <BookmarkCheck className="size-3.5 text-fg" />
                ) : (
                  <Bookmark className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ProfileCard({
  profile,
  onOpen,
}: {
  profile: import("@/lib/x/types").UserProfile;
  onOpen?: (handle: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(profile.handle)}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-2"
    >
      <span className="size-12 shrink-0 overflow-hidden rounded-full bg-surface-2">
        {profile.avatar ? (
          <img
            src={profile.avatar}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{profile.name}</span>
        <span className="block font-mono text-xs text-muted">@{profile.handle}</span>
        {profile.bio && <span className="mt-1 line-clamp-2 block text-sm text-muted">{profile.bio}</span>}
      </span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-subtle">
        {formatCount(profile.followers)}
      </span>
    </button>
  );
}
