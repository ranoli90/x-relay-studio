import type { RedditMessage, RedditThread } from "./types";

export function threadMessages(messages: RedditMessage[]): RedditThread[] {
  const map = new Map<string, RedditMessage[]>();
  for (const m of messages) {
    const list = map.get(m.threadId) ?? [];
    list.push(m);
    map.set(m.threadId, list);
  }
  const threads: RedditThread[] = [];
  for (const [id, msgs] of map) {
    const sorted = [...msgs].sort((a, b) => a.createdUtc - b.createdUtc);
    const latest = sorted[sorted.length - 1];
    const people = new Set<string>();
    for (const m of sorted) {
      if (m.author && m.author !== "[unknown]") people.add(m.author);
      if (m.dest) people.add(m.dest);
    }
    threads.push({
      id,
      subject: latest?.subject ?? "(no subject)",
      participants: [...people],
      latestUtc: latest?.createdUtc ?? 0,
      unread: sorted.filter((m) => m.isNew).length,
      wasComment: sorted.some((m) => m.wasComment),
      subreddit: sorted.find((m) => m.subreddit)?.subreddit ?? null,
      messages: sorted,
    });
  }
  threads.sort((a, b) => {
    if (Boolean(a.unread) !== Boolean(b.unread)) return a.unread ? -1 : 1;
    return b.latestUtc - a.latestUtc;
  });
  return threads;
}
