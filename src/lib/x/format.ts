import type { Tweet } from "./types";

export function engagementScore(t: Tweet): number {
  const { likes = 0, replies = 0, bookmarks = 0, retweets = 0 } = t.metrics;
  return likes + replies * 3 + bookmarks * 2 + retweets;
}

export function sortByEngagement(tweets: Tweet[]): Tweet[] {
  return tweets
    .map((t, i) => ({ t, i, score: engagementScore(t) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ t }) => t);
}

export function sortByNewest(tweets: Tweet[]): Tweet[] {
  return tweets
    .map((t, i) => ({ t, i, ts: t.createdAt ? Date.parse(t.createdAt) : 0 }))
    .sort((a, b) => b.ts - a.ts || a.i - b.i)
    .map(({ t }) => t);
}

export function uniqueTweets(tweets: Tweet[]): Tweet[] {
  const seen = new Set<string>();
  const out: Tweet[] = [];
  for (const t of tweets) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}
