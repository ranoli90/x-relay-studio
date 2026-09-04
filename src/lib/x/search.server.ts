import { chatOpenRouter, extractJson } from "../openrouter.server";
import { sortByEngagement, sortByNewest, uniqueTweets } from "./format";
import { fetchProfile, fetchTweet, hydrateProfiles, hydrateTweets } from "./fxtwitter.server";
import { detectIntent, extractHandle, extractTweetId } from "./ids";
import { buildSearchQuery } from "./query";
import type {
  BriefResult,
  DraftResult,
  RelayResult,
  SearchFilters,
  SearchProduct,
  Trend,
  Tweet,
  UserProfile,
} from "./types";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function tweetFromModel(raw: unknown): Tweet | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id =
    asString(rec.id) ??
    extractTweetId(asString(rec.url) ?? "") ??
    extractTweetId(asString(rec.link) ?? "");
  const handle =
    asString(rec.handle)?.replace(/^@/, "") ??
    extractHandle(asString(rec.url) ?? "") ??
    "unknown";
  if (!id) return null;
  return {
    id,
    url: asString(rec.url) ?? `https://x.com/${handle}/status/${id}`,
    text: asString(rec.text) ?? asString(rec.body) ?? "",
    createdAt: asString(rec.createdAt) ?? asString(rec.date) ?? asString(rec.created_at),
    author: {
      id: "",
      handle,
      name: asString(rec.name) ?? handle,
      verified: rec.verified === true,
    },
    metrics: {
      likes: asNumber(rec.likes),
      retweets: asNumber(rec.retweets ?? rec.reposts),
      replies: asNumber(rec.replies),
      bookmarks: asNumber(rec.bookmarks),
      views: asNumber(rec.views),
      quotes: asNumber(rec.quotes),
    },
    hydrated: false,
  };
}

function trendFromModel(raw: unknown, index: number): Trend | null {
  if (typeof raw === "string" && raw.trim()) return { name: raw.trim(), rank: index + 1 };
  const rec = asRecord(raw);
  if (!rec) return null;
  const name = asString(rec.name) ?? asString(rec.topic) ?? asString(rec.query);
  if (!name) return null;
  return {
    name,
    rank: asNumber(rec.rank) ?? index + 1,
    volume: asString(rec.volume) ?? asString(rec.posts),
    context: asString(rec.context) ?? asString(rec.note),
  };
}

type ChatOptionsXFilter = {
  allowed_x_handles?: string[];
  from_date?: string;
  to_date?: string;
};

async function grokJson(prompt: string, system: string, web: boolean, xFilter?: ChatOptionsXFilter) {
  const result = await chatOpenRouter({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    json: true,
    web,
    maxTokens: web ? 1400 : 900,
    timeoutMs: web ? 55_000 : 40_000,
    xFilter,
  });
  return { data: extractJson(result.text), live: web };
}

const SEARCH_SYSTEM = `You are X Relay, a live X/Twitter research engine.
Use live X search. Return JSON only:
{"tweets":[{"id":"snowflake id","url":"https://x.com/handle/status/id","handle":"handle","name":"Name","text":"post text","likes":0,"retweets":0,"replies":0,"createdAt":"ISO date"}],"note":"one short sentence about the slice"}
Rules:
- Real posts only. Every id must be the numeric status id from an x.com URL.
- Max 8 tweets. Prefer high-engagement and recent unless asked otherwise.
- Skip ads, spam, and duplicate reposts.
- If People is requested, still fill tweets for those accounts' notable posts AND add "users":[{"handle":"","name":""}].`;

async function searchPosts(
  query: string,
  product: SearchProduct,
  filters: SearchFilters,
): Promise<{ tweets: Tweet[]; note?: string; live: boolean; users?: UserProfile[] }> {
  const built = buildSearchQuery(query, {
    ...filters,
    filter: product === "Media" ? ["media", ...(filters.filter ?? [])] : filters.filter,
  });
  const productHint =
    product === "Latest"
      ? "Sort by recency (latest first)."
      : product === "Media"
        ? "Only posts that include images or video."
        : product === "People"
          ? "Return notable accounts matching the query, plus one representative post each."
          : "Sort by engagement (likes + replies + reposts).";

  const { data, live } = await grokJson(
    `Product: ${product}. ${productHint}\nQuery: ${built}`,
    SEARCH_SYSTEM,
    true,
    filters.from ? { allowed_x_handles: [filters.from.replace(/^@/, "")] } : undefined,
  );
  const rec = asRecord(data) ?? {};
  const tweets = uniqueTweets(
    asArray(rec.tweets)
      .map(tweetFromModel)
      .filter((t): t is Tweet => t !== null),
  );
  const hydrated = await hydrateTweets(tweets, 8);
  const ranked = product === "Latest" ? sortByNewest(hydrated) : sortByEngagement(hydrated);

  let users: UserProfile[] | undefined;
  if (product === "People") {
    const handles = asArray(rec.users)
      .map((u) => {
        const r = asRecord(u);
        return asString(r?.handle) ?? asString(r?.username);
      })
      .filter((h): h is string => Boolean(h));
    if (!handles.length) handles.push(...ranked.map((t) => t.author.handle));
    users = await hydrateProfiles(handles, 8);
  }

  return {
    tweets: ranked,
    note: asString(rec.note),
    live,
    users,
  };
}

export async function runRelay(input: {
  q: string;
  product?: SearchProduct;
  filters?: SearchFilters;
}): Promise<RelayResult> {
  const q = input.q.trim();
  if (!q) {
    return { ok: false, error: "Type a search, an @handle, or paste a post link." };
  }
  const product = input.product ?? "Top";
  const filters = input.filters ?? {};
  const intent = detectIntent(q);

  try {
    if (intent.kind === "thread") {
      const root = await fetchTweet(intent.id);
      if (!root) {
        return {
          ok: false,
          error: "That post could not be loaded.",
          hint: "Check the link or id and try again.",
        };
      }
      return {
        ok: true,
        kind: "thread",
        live: true,
        thread: {
          root,
          replies: [],
          returnedCount: 0,
          claimedCount: root.metrics.replies,
          truncated: (root.metrics.replies ?? 0) > 0,
          warning:
            (root.metrics.replies ?? 0) > 0
              ? "Post loaded. Pulling the conversation next."
              : undefined,
        },
      };
    }

    if (intent.kind === "profile") {
      const profile = await fetchProfile(intent.handle);
      if (!profile) {
        return {
          ok: false,
          error: `@${intent.handle} was not found.`,
          hint: "Handles are letters, numbers, and underscores — no spaces.",
        };
      }
      return {
        ok: true,
        kind: "profile",
        profile,
        tweets: [],
        note: "Profile loaded. Fetching recent posts.",
        live: true,
      };
    }

    if (product === "People") {
      const found = await searchPosts(q, "People", filters);
      return {
        ok: true,
        kind: "people",
        query: q,
        users: found.users ?? [],
        note: found.note,
        live: found.live,
      };
    }

    const found = await searchPosts(q, product, filters);
    return {
      ok: true,
      kind: "search",
      query: q,
      product,
      tweets: found.tweets,
      note: found.note,
      live: found.live,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed.";
    return {
      ok: false,
      error: message,
      hint: "Try a simpler query, or paste a post link / @handle.",
    };
  }
}

export async function runProfilePosts(handle: string): Promise<RelayResult> {
  try {
    const found = await searchPosts("", "Latest", { from: handle.replace(/^@/, "") });
    const profile = await fetchProfile(handle);
    if (!profile) {
      return {
        ok: true,
        kind: "search",
        query: `from:${handle}`,
        product: "Latest",
        tweets: found.tweets,
        note: found.note,
        live: found.live,
      };
    }
    return {
      ok: true,
      kind: "profile",
      profile,
      tweets: found.tweets,
      note: found.note,
      live: found.live,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not load posts.",
      hint: "The profile is still here — try searching from:@handle.",
    };
  }
}

export async function runThreadReplies(id: string): Promise<RelayResult> {
  const root = await fetchTweet(id);
  if (!root) {
    return { ok: false, error: "That post could not be loaded." };
  }
  try {
    const { data } = await grokJson(
      `Fetch the reply conversation for this X post. Root: ${root.url}\nAuthor @${root.author.handle}: ${root.text}\nReturn the most relevant replies as tweets JSON (max 8).`,
      SEARCH_SYSTEM,
      true,
    );
    const rec = asRecord(data) ?? {};
    let replies = uniqueTweets(
      asArray(rec.tweets)
        .map(tweetFromModel)
        .filter((t): t is Tweet => t !== null && t.id !== root.id),
    );
    replies = await hydrateTweets(replies, 8);
    return {
      ok: true,
      kind: "thread",
      live: true,
      thread: {
        root,
        replies,
        returnedCount: replies.length,
        claimedCount: root.metrics.replies,
        truncated: (root.metrics.replies ?? 0) > replies.length,
        warning:
          (root.metrics.replies ?? 0) > 0 && replies.length === 0
            ? "X listed replies, but none came back on this pass."
            : undefined,
      },
    };
  } catch (err) {
    return {
      ok: true,
      kind: "thread",
      live: true,
      thread: {
        root,
        replies: [],
        returnedCount: 0,
        claimedCount: root.metrics.replies,
        truncated: (root.metrics.replies ?? 0) > 0,
        warning: err instanceof Error ? err.message : "Replies could not be loaded.",
      },
    };
  }
}

export async function runTrends(): Promise<RelayResult> {
  try {
    const { data, live } = await grokJson(
      "What is trending on X right now worldwide? Return JSON {trends:[{name,volume,context}], note}. 10 items. Use live X.",
      "You track X/Twitter trends. JSON only. Names should be hashtags or short topics people are posting about today.",
      true,
    );
    const rec = asRecord(data) ?? {};
    const trends = asArray(rec.trends)
      .map(trendFromModel)
      .filter((t): t is Trend => t !== null)
      .slice(0, 12);
    if (!trends.length) {
      return { ok: false, error: "No trends came back. Try again in a moment." };
    }
    return { ok: true, kind: "trends", trends, note: asString(rec.note), live };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Trends failed.",
      hint: "Try again — live X trend snapshots are brief.",
    };
  }
}

export async function runBrief(input: {
  query: string;
  tweets: { handle: string; text: string; likes?: number; url: string }[];
}): Promise<{ ok: true; brief: BriefResult } | { ok: false; error: string }> {
  if (!input.tweets.length) {
    return { ok: false, error: "Nothing to brief yet — run a search first." };
  }
  try {
    const { data } = await grokJson(
      `Query: ${input.query}\nPosts:\n${input.tweets
        .slice(0, 8)
        .map((t, i) => `${i + 1}. @${t.handle} (${t.likes ?? 0} likes) ${t.url}\n${t.text}`)
        .join("\n\n")}\n\nWrite a research brief as JSON: {"headline":"","summary":"2-3 sentences","takeaways":["..."],"notable":["@handle — why they matter"]}`,
      "You are a sharp X researcher. No hype, no emojis, no hashtags in the brief. Be specific. JSON only.",
      false,
    );
    const rec = asRecord(data) ?? {};
    const takeaways = asArray(rec.takeaways)
      .map((x) => asString(x))
      .filter((x): x is string => Boolean(x));
    const notable = asArray(rec.notable)
      .map((x) => asString(x))
      .filter((x): x is string => Boolean(x));
    return {
      ok: true,
      brief: {
        headline: asString(rec.headline) ?? "Brief",
        summary: asString(rec.summary) ?? asString(rec.note) ?? "",
        takeaways: takeaways.slice(0, 6),
        notable: notable.slice(0, 6),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Brief failed." };
  }
}

export async function runDraft(input: {
  kind: "post" | "reply" | "quote";
  instruction?: string;
  target?: { handle: string; text: string };
  context?: { handle: string; text: string }[];
}): Promise<{ ok: true; draft: DraftResult } | { ok: false; error: string }> {
  try {
    const { data } = await grokJson(
      `Write one ${input.kind} for X.\nInstruction: ${input.instruction || "sound like a sharp, specific human"}\nTarget: ${
        input.target ? `@${input.target.handle}: ${input.target.text}` : "n/a"
      }\nContext:\n${(input.context ?? [])
        .slice(0, 5)
        .map((t) => `@${t.handle}: ${t.text}`)
        .join("\n")}\nJSON: {"text":"the post, under 280 characters"}`,
      "You draft posts for X. No hashtag stuffing, no emoji, no 'Excited to share'. Sound like a person. JSON only.",
      false,
    );
    const rec = asRecord(data) ?? {};
    const text = asString(rec.text) ?? asString(rec.draft);
    if (!text) return { ok: false, error: "No draft came back." };
    return { ok: true, draft: { text: text.slice(0, 280), kind: input.kind } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Draft failed." };
  }
}

const ARCHIVE_SYSTEM = `You collect a full X/Twitter archive for one account.
Use live X search. Return JSON only:
{"tweets":[{"id":"snowflake id","url":"https://x.com/handle/status/id","handle":"handle","name":"Name","text":"post text","likes":0,"retweets":0,"replies":0,"createdAt":"ISO date"}],"note":"short"}
Rules:
- Real posts only. Every id must be the numeric status id from an x.com URL.
- Return as many distinct posts from THIS account as you can, up to 20.
- Include originals, replies, and quotes. Skip ads and other people's posts.
- Honor the date window. When asked for posts older than a date, return the
  next-oldest posts immediately before that date (do not jump years, do not
  repeat newer posts).`;

export async function searchAccountWindow(
  handle: string,
  opts: { since?: string; until?: string } = {},
): Promise<{ tweets: Tweet[]; note?: string; live: boolean }> {
  const from = handle.replace(/^@/, "");
  const windowHint = opts.until
    ? `Posts FROM @${from} only, strictly older than ${opts.until}. Return the next-oldest slice (the posts just before that date), newest-first within the slice. Do not include posts from ${opts.until} or later.${opts.since ? ` Stay on or after ${opts.since} if you can.` : ""}`
    : `Collect the latest posts FROM @${from} only. No date cap.`;
  const { data, live } = await grokJson(windowHint, ARCHIVE_SYSTEM, true, {
    allowed_x_handles: [from],
    from_date: opts.since,
    to_date: opts.until,
  });
  const rec = asRecord(data) ?? {};
  const tweets = uniqueTweets(
    asArray(rec.tweets)
      .map(tweetFromModel)
      .filter((t): t is Tweet => t !== null)
      .filter((t) => tweetBelongsTo(t, from)),
  );
  // Hydrate later, and only for tweets we have not stored — catch-up must not
  // re-fetch 20 fxtwitter payloads we already have.
  return { tweets: sortByNewest(tweets), note: asString(rec.note), live };
}

function tweetBelongsTo(tweet: Tweet, handle: string): boolean {
  const want = handle.replace(/^@/, "").toLowerCase();
  const got = tweet.author.handle.replace(/^@/, "").toLowerCase();
  if (got && got !== "unknown") return got === want;
  return (tweet.url || "").toLowerCase().includes(`/${want}/`);
}

