import { oauthGet } from "./client";
import { threadMessages } from "./thread";
import type { InboxSnapshot, RedditMessage } from "./types";

type ListingChild = {
  kind?: string;
  data?: Record<string, unknown>;
};

type Listing = {
  data?: {
    after?: string | null;
    children?: ListingChild[];
  };
};

function asMessage(child: ListingChild): RedditMessage | null {
  const d = child.data;
  if (!d) return null;
  const fullname = String(d.name ?? "");
  const id = String(d.id ?? fullname);
  if (!id) return null;
  const wasComment = Boolean(d.was_comment) || child.kind === "t1";
  const first = d.first_message_name ? String(d.first_message_name) : "";
  const threadId = first || fullname || id;
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
    context: d.context ? String(d.context) : null,
  };
}

async function fetchListing(
  accessToken: string,
  userAgent: string,
  where: "inbox" | "sent" | "unread",
  pages = 3,
) {
  const out: RedditMessage[] = [];
  let after: string | null = null;
  for (let i = 0; i < pages; i += 1) {
    const path: string =
      `/message/${where}?limit=100&raw_json=1` +
      (after ? `&after=${encodeURIComponent(after)}` : "");
    const { data } = await oauthGet<Listing>({
      accessToken,
      userAgent,
      path,
    });
    const children = data.data?.children ?? [];
    for (const child of children) {
      const msg = asMessage(child);
      if (msg) out.push(msg);
    }
    after = data.data?.after ?? null;
    if (!after || children.length === 0) break;
  }
  return out;
}

export async function fetchInbox(opts: {
  accessToken: string;
  userAgent: string;
}): Promise<InboxSnapshot> {
  const [inbox, sent] = await Promise.all([
    fetchListing(opts.accessToken, opts.userAgent, "inbox", 3),
    fetchListing(opts.accessToken, opts.userAgent, "sent", 2),
  ]);
  const byId = new Map<string, RedditMessage>();
  for (const m of [...inbox, ...sent]) byId.set(m.fullname || m.id, m);
  const messages = [...byId.values()];
  const threads = threadMessages(messages);
  return {
    threads,
    unreadCount: messages.filter((m) => m.isNew).length,
    fetchedAt: new Date().toISOString(),
    truncated: inbox.length >= 300 || sent.length >= 200,
  };
}
