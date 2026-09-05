import type { RedditMessage } from "./types";

export type ListingChild = {
  kind?: string;
  data?: Record<string, unknown>;
};

export function asMessage(child: ListingChild): RedditMessage | null {
  const d = child.data;
  if (!d) return null;
  const fullname = String(d.name ?? "");
  const id = String(d.id ?? fullname);
  if (!id) return null;
  const wasComment = Boolean(d.was_comment) || child.kind === "t1";
  const first = d.first_message_name ? String(d.first_message_name) : "";
  const threadId = first || fullname || id;
  const context = d.context ? String(d.context) : null;
  return {
    id,
    fullname,
    kind: wasComment ? "comment" : "message",
    author: String(d.author ?? "[unknown]"),
    dest: String(d.dest ?? ""),
    subject: String(d.subject ?? (wasComment ? "Comment reply" : "(no subject)")),
    body: String(d.body ?? ""),
    createdUtc: Number(d.created_utc ?? 0),
    isNew: Boolean(d.new),
    wasComment,
    threadId,
    subreddit: d.subreddit ? String(d.subreddit) : null,
    context,
  };
}

export function redditPermalink(context: string | null) {
  if (!context) return null;
  if (context.startsWith("http")) return context;
  if (context.startsWith("/")) return `https://www.reddit.com${context}`;
  return null;
}
