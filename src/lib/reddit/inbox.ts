import { oauthGet } from "./client";
import { asMessage, type ListingChild } from "./parse";
import { threadMessages } from "./thread";
import type { InboxSnapshot, RedditMessage } from "./types";

type Listing = {
  data?: {
    after?: string | null;
    children?: ListingChild[];
  };
};

async function fetchListing(
  accessToken: string,
  userAgent: string,
  where: "inbox" | "sent" | "unread" | "mentions",
  pages = 2,
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
  const inbox = await fetchListing(opts.accessToken, opts.userAgent, "inbox", 3);
  const sent = await fetchListing(opts.accessToken, opts.userAgent, "sent", 1);
  const mentions = await fetchListing(opts.accessToken, opts.userAgent, "mentions", 1);
  const byId = new Map<string, RedditMessage>();
  for (const m of [...inbox, ...sent, ...mentions]) byId.set(m.fullname || m.id, m);
  const messages = [...byId.values()];
  const threads = threadMessages(messages);
  return {
    threads,
    unreadCount: messages.filter((m) => m.isNew).length,
    fetchedAt: new Date().toISOString(),
    truncated: inbox.length >= 300 || sent.length >= 100 || mentions.length >= 100,
  };
}
