import type { Tweet } from "./types";

export type ArchiveWindowOpts = {
  since?: string;
  until?: string;
};

export function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, "").trim().toLowerCase();
}

export function tweetBelongsTo(
  tweet: { author?: { handle?: string }; url?: string },
  handle: string,
): boolean {
  const want = normalizeHandle(handle);
  if (!want) return false;
  const got = normalizeHandle(tweet.author?.handle ?? "");
  if (got && got !== "unknown") return got === want;
  return (tweet.url || "").toLowerCase().includes(`/${want}/`);
}

export function tweetDay(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const value = iso.includes("T") ? iso : `${iso}T00:00:00.000Z`;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

export function tweetInWindow(tweet: { createdAt?: string }, opts: ArchiveWindowOpts): boolean {
  const day = tweetDay(tweet.createdAt);
  if (!day) return true;
  if (opts.until && day >= opts.until) return false;
  if (opts.since && day < opts.since) return false;
  return true;
}

export type ArchiveSliceStats = {
  live: boolean;
  kept: number;
  droppedWrongAccount: number;
  droppedOutOfWindow: number;
  undated: number;
};

export function archiveWindowPartial(stats: ArchiveSliceStats): boolean {
  if (!stats.live) return true;
  if (stats.droppedWrongAccount > 0) return true;
  if (stats.droppedOutOfWindow > 0) return true;
  if (stats.undated > 0) return true;
  return false;
}

export function filterArchiveWindow(
  tweets: Tweet[],
  handle: string,
  opts: ArchiveWindowOpts,
): { tweets: Tweet[]; partial: boolean; stats: ArchiveSliceStats } {
  let droppedWrongAccount = 0;
  let droppedOutOfWindow = 0;
  let undated = 0;
  const kept: Tweet[] = [];
  for (const tweet of tweets) {
    if (!tweetBelongsTo(tweet, handle)) {
      droppedWrongAccount += 1;
      continue;
    }
    if (!tweetInWindow(tweet, opts)) {
      droppedOutOfWindow += 1;
      continue;
    }
    if (!tweet.createdAt) undated += 1;
    kept.push(tweet);
  }
  const stats: ArchiveSliceStats = {
    live: true,
    kept: kept.length,
    droppedWrongAccount,
    droppedOutOfWindow,
    undated,
  };
  return { tweets: kept, partial: archiveWindowPartial(stats), stats };
}
