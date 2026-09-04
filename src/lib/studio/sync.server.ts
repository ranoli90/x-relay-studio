import { getSql, type Sql } from "@/lib/db";
import { chatOpenRouter, extractJson } from "@/lib/openrouter.server";
import { fetchProfile } from "@/lib/x/fxtwitter.server";
import { searchAccountWindow } from "@/lib/x/search.server";
import type { MediaItem, Metrics, Tweet } from "@/lib/x/types";
import type {
  AddSourcesResult,
  LookupProfile,
  Publisher,
  PublisherKit,
  SourceRow,
  SourceStatus,
  StoredPost,
  TickResult,
  VoiceBrief,
} from "./types";

const EMPTY_WINDOWS_STOP = 5;
const REWRITE_BATCH = 8;
const CATCHUP_MINUTES = 12;
const ERROR_BACKOFF_MINUTES = 2;
const WINDOW_DAYS = 45;

type PublisherRow = {
  id: string;
  handle: string;
  name: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  source: string;
  kit: unknown;
  created_at: string;
};

type SourceDb = {
  id: string;
  user_id: string;
  publisher_id: string;
  handle: string;
  name: string;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  followers: number;
  tweets_claimed: number;
  tweets_synced: number;
  media_synced: number;
  rewritten: number;
  status: string;
  stage: string | null;
  error: string | null;
  voice: unknown;
  oldest_at: string | null;
  newest_at: string | null;
  empty_windows: number;
  last_synced_at: string | null;
  backfill_done: boolean;
  windows_run: number;
  cursor_until: string | null;
};

type PostDb = {
  id: string;
  source_id: string;
  tweet_id: string;
  url: string | null;
  text: string;
  created_at: string | null;
  metrics: unknown;
  media: unknown;
  is_reply: boolean;
  is_retweet: boolean;
  is_quote: boolean;
  rewrite_text: string | null;
  rewrite_status: string;
};

function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function mapPublisher(row: PublisherRow): Publisher {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    avatar: row.avatar,
    banner: row.banner,
    bio: row.bio,
    source: row.source,
    kit: asJson<PublisherKit | null>(row.kit, null),
    createdAt: row.created_at,
  };
}

function mapSource(row: SourceDb): SourceRow {
  return {
    id: row.id,
    publisherId: row.publisher_id,
    handle: row.handle,
    name: row.name,
    avatar: row.avatar,
    banner: row.banner,
    bio: row.bio,
    followers: Number(row.followers) || 0,
    tweetsClaimed: Number(row.tweets_claimed) || 0,
    tweetsSynced: Number(row.tweets_synced) || 0,
    mediaSynced: Number(row.media_synced) || 0,
    rewritten: Number(row.rewritten) || 0,
    status: (row.status as SourceStatus) || "pending",
    stage: row.stage,
    error: row.error,
    voice: asJson<VoiceBrief | null>(row.voice, null),
    lastSyncedAt: row.last_synced_at,
    backfillDone: Boolean(row.backfill_done),
    windowsRun: Number(row.windows_run) || 0,
  };
}

function mapPost(row: PostDb): StoredPost {
  return {
    id: row.id,
    sourceId: row.source_id,
    tweetId: row.tweet_id,
    url: row.url,
    text: row.text,
    createdAt: row.created_at,
    metrics: asJson<Metrics>(row.metrics, {}),
    media: asJson<MediaItem[]>(row.media, []),
    isReply: Boolean(row.is_reply),
    isRetweet: Boolean(row.is_retweet),
    isQuote: Boolean(row.is_quote),
    rewriteText: row.rewrite_text,
    rewriteStatus:
      row.rewrite_status === "done" || row.rewrite_status === "skipped"
        ? row.rewrite_status
        : "pending",
  };
}

async function loadSource(sql: Sql, userId: string, sourceId: string): Promise<SourceDb | null> {
  const rows = await sql<SourceDb>`
    select * from sources where id = ${sourceId} and user_id = ${userId} limit 1
  `;
  return rows[0] ?? null;
}

async function refreshCounts(sql: Sql, sourceId: string): Promise<void> {
  let mediaSynced = 0;
  try {
    const mediaRows = await sql<{ n: unknown }>`
      select coalesce(sum(jsonb_array_length(coalesce(media, '[]'::jsonb))), 0) as n
      from posts where source_id = ${sourceId}
    `;
    mediaSynced = Number(mediaRows[0]?.n ?? 0) || 0;
  } catch {
    const rows = await sql<{ media: unknown }>`
      select media from posts where source_id = ${sourceId}
    `;
    for (const row of rows) {
      const media = asJson<unknown[]>(row.media, []);
      mediaSynced += Array.isArray(media) ? media.length : 0;
    }
  }
  await sql`
    update sources set
      tweets_synced = (select count(*) from posts where source_id = ${sourceId}),
      media_synced = ${mediaSynced},
      rewritten = (select count(*) from posts where source_id = ${sourceId} and rewrite_status = 'done'),
      last_synced_at = now()
    where id = ${sourceId}
  `;
}

export async function listStudio(userId: string) {
  const sql = await getSql();
  const publishers = await sql<PublisherRow>`
    select id, handle, name, avatar, banner, bio, source, kit, created_at
    from publishers where user_id = ${userId}
    order by created_at asc
  `;
  const sources = await sql<SourceDb>`
    select * from sources where user_id = ${userId}
    order by created_at desc
  `;
  return {
    publishers: publishers.map(mapPublisher),
    sources: sources.map(mapSource),
  };
}

export async function lookupHandle(handle: string): Promise<LookupProfile | null> {
  const profile = await fetchProfile(handle);
  if (!profile) return null;
  return {
    handle: profile.handle,
    name: profile.name,
    avatar: profile.avatar ?? null,
    banner: profile.banner ?? null,
    bio: profile.bio ?? null,
    followers: profile.followers,
    tweets: profile.tweets,
    verified: profile.verified,
  };
}

export async function connectPublisher(
  userId: string,
  handle: string,
  source = "handle",
): Promise<Publisher> {
  const sql = await getSql();
  const profile = await fetchProfile(handle);
  if (!profile) {
    throw new Error(`@${handle.replace(/^@/, "")} was not found.`);
  }
  const existing = await sql<PublisherRow>`
    select id, handle, name, avatar, banner, bio, source, kit, created_at
    from publishers
    where user_id = ${userId} and lower(handle) = ${profile.handle.toLowerCase()}
    limit 1
  `;
  if (existing[0]) {
    await sql`
      update publishers set
        handle = ${profile.handle},
        name = ${profile.name},
        avatar = ${profile.avatar ?? null},
        banner = ${profile.banner ?? null},
        bio = ${profile.bio ?? null}
      where id = ${existing[0].id} and user_id = ${userId}
    `;
    const updated = await sql<PublisherRow>`
      select id, handle, name, avatar, banner, bio, source, kit, created_at
      from publishers where id = ${existing[0].id} limit 1
    `;
    return mapPublisher(updated[0]!);
  }
  const id = crypto.randomUUID();
  await sql`
    insert into publishers (id, user_id, handle, name, avatar, banner, bio, x_user_id, source)
    values (
      ${id},
      ${userId},
      ${profile.handle},
      ${profile.name},
      ${profile.avatar ?? null},
      ${profile.banner ?? null},
      ${profile.bio ?? null},
      ${profile.id || null},
      ${source}
    )
  `;
  const rows = await sql<PublisherRow>`
    select id, handle, name, avatar, banner, bio, source, kit, created_at
    from publishers where id = ${id} limit 1
  `;
  return mapPublisher(rows[0]!);
}

export async function removePublisher(userId: string, publisherId: string): Promise<void> {
  const sql = await getSql();
  const owned = await sql<{ id: string }>`
    select id from publishers where id = ${publisherId} and user_id = ${userId} limit 1
  `;
  if (!owned[0]) return;
  await sql`delete from posts where user_id = ${userId} and source_id in (select id from sources where publisher_id = ${publisherId} and user_id = ${userId})`;
  await sql`delete from sources where publisher_id = ${publisherId} and user_id = ${userId}`;
  await sql`delete from publishers where id = ${publisherId} and user_id = ${userId}`;
}

export async function addSources(
  userId: string,
  publisherId: string,
  handles: string[],
): Promise<AddSourcesResult> {
  const sql = await getSql();
  const pub = await sql<{ id: string; handle: string }>`
    select id, handle from publishers where id = ${publisherId} and user_id = ${userId} limit 1
  `;
  if (!pub[0]) throw new Error("Pick a posting account first.");

  const unique = [...new Set(handles.map((h) => h.replace(/^@/, "").trim()).filter(Boolean))];
  const added: SourceRow[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  const pubHandle = pub[0].handle.toLowerCase();

  for (const handle of unique) {
    if (handle.toLowerCase() === pubHandle) {
      skipped.push(handle);
      continue;
    }
    const exists = await sql<{ id: string }>`
      select id from sources
      where publisher_id = ${publisherId} and lower(handle) = ${handle.toLowerCase()}
      limit 1
    `;
    if (exists[0]) {
      skipped.push(handle);
      continue;
    }
    const profile = await fetchProfile(handle);
    if (!profile) {
      missing.push(handle);
      continue;
    }
    const id = crypto.randomUUID();
    await sql`
      insert into sources (
        id, user_id, publisher_id, handle, name, avatar, banner, bio,
        followers, tweets_claimed, status, stage
      ) values (
        ${id},
        ${userId},
        ${publisherId},
        ${profile.handle},
        ${profile.name},
        ${profile.avatar ?? null},
        ${profile.banner ?? null},
        ${profile.bio ?? null},
        ${profile.followers},
        ${profile.tweets},
        'pending',
        'queued'
      )
    `;
    const row = await loadSource(sql, userId, id);
    if (row) added.push(mapSource(row));
  }

  return { added, skipped, missing };
}

export async function removeSources(userId: string, ids: string[]): Promise<void> {
  const sql = await getSql();
  for (const id of ids) {
    await sql`delete from posts where source_id = ${id} and user_id = ${userId}`;
    await sql`delete from sources where id = ${id} and user_id = ${userId}`;
  }
}

export async function moveSources(
  userId: string,
  ids: string[],
  publisherId: string,
): Promise<void> {
  const sql = await getSql();
  const pub = await sql<{ id: string }>`
    select id from publishers where id = ${publisherId} and user_id = ${userId} limit 1
  `;
  if (!pub[0]) throw new Error("That posting account is gone.");
  for (const id of ids) {
    await sql`
      update sources set publisher_id = ${publisherId}
      where id = ${id} and user_id = ${userId}
    `;
  }
}

export async function listPosts(
  userId: string,
  sourceId: string,
  offset = 0,
  limit = 40,
  oldestFirst = false,
): Promise<{ posts: StoredPost[]; total: number }> {
  const sql = await getSql();
  const owned = await sql<{ id: string }>`
    select id from sources where id = ${sourceId} and user_id = ${userId} limit 1
  `;
  if (!owned[0]) return { posts: [], total: 0 };
  const count = await sql<{ n: number }>`
    select count(*)::int as n from posts where source_id = ${sourceId}
  `;
  const rows = oldestFirst
    ? await sql<PostDb>`
        select * from posts
        where source_id = ${sourceId}
        order by created_at asc nulls last, stored_at asc
        limit ${limit} offset ${offset}
      `
    : await sql<PostDb>`
        select * from posts
        where source_id = ${sourceId}
        order by created_at desc nulls last, stored_at desc
        limit ${limit} offset ${offset}
      `;
  return { posts: rows.map(mapPost), total: count[0]?.n ?? 0 };
}

export async function exportPublisher(userId: string, publisherId: string) {
  const sql = await getSql();
  const pub = await sql<PublisherRow>`
    select id, handle, name, avatar, banner, bio, source, kit, created_at
    from publishers where id = ${publisherId} and user_id = ${userId} limit 1
  `;
  if (!pub[0]) throw new Error("Posting account not found.");
  const sources = await sql<SourceDb>`
    select * from sources where publisher_id = ${publisherId} and user_id = ${userId}
    order by handle asc
  `;
  const packs = [];
  for (const source of sources) {
    const posts = await sql<PostDb>`
      select * from posts where source_id = ${source.id}
      order by created_at desc nulls last
    `;
    packs.push({
      source: mapSource(source),
      posts: posts.map(mapPost),
    });
  }
  return {
    schema: "x-relay/studio@1",
    generatedAt: new Date().toISOString(),
    publisher: mapPublisher(pub[0]),
    sources: packs,
  };
}

async function insertTweets(sql: Sql, userId: string, source: SourceDb, tweets: Tweet[]): Promise<number> {
  let added = 0;
  for (const tweet of tweets) {
    const exists = await sql<{ id: string }>`
      select id from posts where source_id = ${source.id} and tweet_id = ${tweet.id} limit 1
    `;
    if (exists[0]) continue;
    const skipRewrite = tweet.isRetweet || !tweet.text.trim();
    await sql`
      insert into posts (
        id, user_id, source_id, tweet_id, url, text, created_at, metrics, media,
        is_reply, is_retweet, is_quote, rewrite_status
      ) values (
        ${crypto.randomUUID()},
        ${userId},
        ${source.id},
        ${tweet.id},
        ${tweet.url},
        ${tweet.text},
        ${tweet.createdAt ?? null},
        ${JSON.stringify(tweet.metrics)}::jsonb,
        ${JSON.stringify(tweet.mediaItems ?? [])}::jsonb,
        ${Boolean(tweet.isReply)},
        ${Boolean(tweet.isRetweet)},
        ${Boolean(tweet.isQuote)},
        ${skipRewrite ? "skipped" : "pending"}
      )
    `;
    added += 1;
  }
  return added;
}

function day(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fetchedOldestIso(tweets: Tweet[]): string | null {
  let min = Number.POSITIVE_INFINITY;
  for (const tweet of tweets) {
    if (!tweet.createdAt) continue;
    const t = Date.parse(tweet.createdAt);
    if (Number.isFinite(t) && t < min) min = t;
  }
  return Number.isFinite(min) ? new Date(min).toISOString() : null;
}

function nextCursor(current: string | undefined, tweets: Tweet[]): string | undefined {
  const oldest = fetchedOldestIso(tweets);
  if (oldest) {
    const proposed = shiftDays(oldest, -1);
    if (!current || proposed < current) return proposed;
  }
  // Duplicate or undated slice — still walk back so we never stall on the same window.
  return current ? shiftDays(current, -7) : oldest ? shiftDays(oldest, -7) : current;
}

async function generateVoice(
  publisherHandle: string,
  source: SourceDb,
  samples: { text: string }[],
): Promise<VoiceBrief> {
  const result = await chatOpenRouter({
    messages: [
      {
        role: "system",
        content:
          "You design a posting voice for a NEW X account. JSON only: {\"voice\":\"2-3 sentences\",\"topics\":[\"...\"],\"bio\":\"under 160 chars\",\"pinned\":\"one post under 280 chars\"}. No hashtags, no emoji stuffing, no mentioning the source handle.",
      },
      {
        role: "user",
        content: `The new account will post as @${publisherHandle}. Source material is @${source.handle} (${source.name}). Bio: ${source.bio ?? ""}\nSample posts:\n${samples
          .slice(0, 12)
          .map((p, i) => `${i + 1}. ${p.text}`)
          .join("\n")}`,
      },
    ],
    json: true,
    maxTokens: 700,
    temperature: 0.4,
    timeoutMs: 40_000,
  });
  const rec = extractJson(result.text) as Record<string, unknown>;
  const topics = Array.isArray(rec.topics)
    ? rec.topics.filter((t): t is string => typeof t === "string").slice(0, 8)
    : [];
  return {
    voice: typeof rec.voice === "string" ? rec.voice : "Clear, specific, human. Short sentences.",
    topics,
    bio: typeof rec.bio === "string" ? rec.bio.slice(0, 160) : "",
    pinned: typeof rec.pinned === "string" ? rec.pinned.slice(0, 280) : "",
  };
}

async function rewriteBatch(
  publisherHandle: string,
  sourceHandle: string,
  voice: VoiceBrief,
  posts: PostDb[],
): Promise<Map<string, string>> {
  const result = await chatOpenRouter({
    messages: [
      {
        role: "system",
        content:
          "You rewrite X posts for a new account. Keep the core claim, drop the original voice, do not mention the source. No hashtags, no emoji stuffing. Each rewrite ≤280 characters. JSON only: {\"rewrites\":[{\"id\":\"\",\"text\":\"\"}]}",
      },
      {
        role: "user",
        content: `Post as @${publisherHandle}. Voice: ${voice.voice}\nTopics: ${voice.topics.join(", ")}\nSource was @${sourceHandle}. Rewrite these:\n${posts
          .map((p) => `- id:${p.id}\n${p.text}`)
          .join("\n\n")}`,
      },
    ],
    json: true,
    maxTokens: 1400,
    temperature: 0.5,
    timeoutMs: 45_000,
  });
  const rec = extractJson(result.text) as { rewrites?: unknown };
  const map = new Map<string, string>();
  const list = Array.isArray(rec.rewrites) ? rec.rewrites : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; text?: unknown };
    if (typeof row.id !== "string" || typeof row.text !== "string") continue;
    const text = row.text.trim().slice(0, 280);
    if (text) map.set(row.id, text);
  }
  return map;
}

export async function tickSource(userId: string, sourceId: string): Promise<TickResult> {
  const sql = await getSql();
  const source = await loadSource(sql, userId, sourceId);
  if (!source) throw new Error("Source not found.");

  const pub = await sql<PublisherRow>`
    select id, handle, name, avatar, banner, bio, source, kit, created_at
    from publishers where id = ${source.publisher_id} and user_id = ${userId} limit 1
  `;
  if (!pub[0]) throw new Error("Posting account missing.");

  let addedPosts = 0;
  let rewrittenNow = 0;

  try {
    if (source.status === "error" || source.status === "pending") {
      const pendingRewrites = await sql<{ n: number }>`
        select count(*)::int as n from posts
        where source_id = ${source.id} and rewrite_status = 'pending'
      `;
      const next =
        source.backfill_done && (pendingRewrites[0]?.n ?? 0) > 0
          ? "rewriting"
          : source.backfill_done && (pendingRewrites[0]?.n ?? 0) === 0
            ? "ready"
            : "syncing";
      await sql`
        update sources set status = ${next}, stage = ${next === "ready" ? "monitor" : next === "rewriting" ? "rewrite" : "posts"}, error = null
        where id = ${source.id}
      `;
      source.status = next;
    }

    if (source.status === "ready") {
      addedPosts = await catchUpNewer(sql, userId, source);
      const leftover = await sql<{ n: number }>`
        select count(*)::int as n from posts
        where source_id = ${source.id} and rewrite_status = 'pending'
      `;
      if ((leftover[0]?.n ?? 0) > 0) {
        await sql`
          update sources set status = 'rewriting', stage = 'rewrite', error = null where id = ${source.id}
        `;
        source.status = "rewriting";
      } else {
        await sql`
          update sources set status = 'ready', stage = 'monitor', error = null where id = ${source.id}
        `;
        await refreshCounts(sql, source.id);
      }
    }

    if (source.status === "syncing") {
      const emptyStreak = Number(source.empty_windows) || 0;
      const until =
        day(source.cursor_until) ??
        (source.oldest_at ? shiftDays(source.oldest_at, -1) : undefined);
      const since = until ? shiftDays(until, -WINDOW_DAYS) : undefined;

      const found = await searchAccountWindow(source.handle, { since, until });
      addedPosts = await insertTweets(sql, userId, source, found.tweets);

      const bounds = await sql<{ oldest: string | null; newest: string | null }>`
        select min(created_at) as oldest, max(created_at) as newest
        from posts where source_id = ${source.id}
      `;

      const empty = found.tweets.length === 0 ? emptyStreak + 1 : 0;
      const cursorUntil = found.tweets.length === 0 ? until : nextCursor(until, found.tweets);
      const backfillDone = empty >= EMPTY_WINDOWS_STOP;
      const windowsRun = (Number(source.windows_run) || 0) + 1;
      const storedCount = (Number(source.tweets_synced) || 0) + addedPosts;
      const stalledEmpty = backfillDone && storedCount === 0;

      await sql`
        update sources set
          empty_windows = ${empty},
          windows_run = ${windowsRun},
          oldest_at = ${bounds[0]?.oldest ?? source.oldest_at},
          newest_at = ${bounds[0]?.newest ?? source.newest_at},
          cursor_until = ${cursorUntil ?? null},
          backfill_done = ${stalledEmpty ? false : backfillDone},
          status = ${stalledEmpty ? "error" : backfillDone ? "rewriting" : "syncing"},
          stage = ${stalledEmpty ? "posts" : backfillDone ? "rewrite" : "posts"},
          error = ${stalledEmpty ? "No posts came back. Resume to keep trying — nothing was wiped." : null}
        where id = ${source.id}
      `;
      await refreshCounts(sql, source.id);
      source.status = stalledEmpty ? "error" : backfillDone ? "rewriting" : "syncing";
    }

    if (source.status === "rewriting") {
      const fresh = await loadSource(sql, userId, sourceId);
      if (fresh && !fresh.voice) {
        const samples = await sql<{ text: string }>`
          select text from posts
          where source_id = ${source.id} and coalesce(text, '') <> ''
          order by created_at asc nulls last
          limit 12
        `;
        const voice = await generateVoice(pub[0].handle, fresh, samples);
        await sql`
          update sources set voice = ${JSON.stringify(voice)}::jsonb where id = ${source.id}
        `;
        if (!pub[0].kit) {
          const kit: PublisherKit = { bio: voice.bio, pinned: voice.pinned };
          await sql`
            update publishers set kit = ${JSON.stringify(kit)}::jsonb
            where id = ${pub[0].id} and user_id = ${userId} and kit is null
          `;
        }
        source.voice = voice;
      }

      const voice = asJson<VoiceBrief | null>(
        (await loadSource(sql, userId, sourceId))?.voice,
        null,
      ) ?? {
        voice: "Clear, specific, human.",
        topics: [],
        bio: "",
        pinned: "",
      };

      const pending = await sql<PostDb>`
        select * from posts
        where source_id = ${source.id} and rewrite_status = 'pending'
        order by created_at asc nulls last
        limit ${REWRITE_BATCH}
      `;

      if (pending.length === 0) {
        await sql`
          update sources set status = 'ready', stage = 'monitor', error = null where id = ${source.id}
        `;
        await refreshCounts(sql, source.id);
      } else {
        const map = await rewriteBatch(pub[0].handle, source.handle, voice, pending);
        for (const post of pending) {
          const text = map.get(post.id);
          if (text) {
            await sql`
              update posts set rewrite_text = ${text}, rewrite_status = 'done' where id = ${post.id}
            `;
            rewrittenNow += 1;
          }
          // Leave unmatched as pending so a stop/retry does not skip them.
        }
        const leftover = await sql<{ n: number }>`
          select count(*)::int as n from posts
          where source_id = ${source.id} and rewrite_status = 'pending'
        `;
        if ((leftover[0]?.n ?? 0) === 0) {
          await sql`
            update sources set status = 'ready', stage = 'monitor', error = null where id = ${source.id}
          `;
        }
        await refreshCounts(sql, source.id);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    await sql`
      update sources set status = 'error', error = ${message}, last_synced_at = now()
      where id = ${source.id}
    `;
  }

  const latest = await loadSource(sql, userId, sourceId);
  if (!latest) throw new Error("Source disappeared.");
  return {
    source: mapSource(latest),
    addedPosts,
    rewrittenNow,
    done: latest.status === "ready" || latest.status === "error",
  };
}

async function catchUpNewer(sql: Sql, userId: string, source: SourceDb): Promise<number> {
  const since = source.newest_at ? day(source.newest_at) : undefined;
  const found = await searchAccountWindow(source.handle, { since });
  const added = await insertTweets(sql, userId, source, found.tweets);
  const bounds = await sql<{ oldest: string | null; newest: string | null }>`
    select min(created_at) as oldest, max(created_at) as newest
    from posts where source_id = ${source.id}
  `;
  await sql`
    update sources set
      oldest_at = ${bounds[0]?.oldest ?? source.oldest_at},
      newest_at = ${bounds[0]?.newest ?? source.newest_at},
      error = null
    where id = ${source.id}
  `;
  await refreshCounts(sql, source.id);
  return added;
}

export async function retrySource(userId: string, sourceId: string): Promise<SourceRow> {
  const sql = await getSql();
  const row = await loadSource(sql, userId, sourceId);
  if (!row) throw new Error("Source not found.");
  const pending = await sql<{ n: number }>`
    select count(*)::int as n from posts
    where source_id = ${sourceId} and rewrite_status = 'pending'
  `;
  const pendingN = pending[0]?.n ?? 0;
  const next =
    row.backfill_done && pendingN > 0
      ? "rewriting"
      : row.backfill_done
        ? "ready"
        : "syncing";
  await sql`
    update sources set
      status = ${next},
      stage = ${next === "ready" ? "monitor" : next === "rewriting" ? "rewrite" : "posts"},
      error = null
    where id = ${sourceId} and user_id = ${userId}
  `;
  const latest = await loadSource(sql, userId, sourceId);
  if (!latest) throw new Error("Source not found.");
  return mapSource(latest);
}

export function sourceNeedsWork(source: {
  status: string;
  lastSyncedAt: string | null;
}): boolean {
  if (source.status === "pending" || source.status === "syncing" || source.status === "rewriting") {
    return true;
  }
  if (source.status === "error") {
    if (!source.lastSyncedAt) return true;
    const t = Date.parse(source.lastSyncedAt);
    return Number.isNaN(t) || Date.now() - t > ERROR_BACKOFF_MINUTES * 60 * 1000;
  }
  if (source.status !== "ready") return false;
  if (!source.lastSyncedAt) return true;
  const t = Date.parse(source.lastSyncedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > CATCHUP_MINUTES * 60 * 1000;
}

export async function tickDueSources(limit = 4): Promise<{ ticked: number }> {
  const sql = await getSql();
  const rows = await sql<SourceDb>`
    select * from sources
    where status in ('pending', 'syncing', 'rewriting')
       or (
         status = 'error'
         and coalesce(last_synced_at, '1970-01-01'::timestamptz) < now() - interval '2 minutes'
       )
       or (
         status = 'ready'
         and coalesce(last_synced_at, '1970-01-01'::timestamptz) < now() - interval '12 minutes'
       )
    order by
      case status
        when 'syncing' then 0
        when 'rewriting' then 1
        when 'pending' then 2
        when 'error' then 3
        else 4
      end,
      last_synced_at asc nulls first
    limit ${limit}
  `;
  let ticked = 0;
  for (const row of rows) {
    await tickSource(row.user_id, row.id);
    ticked += 1;
  }
  return { ticked };
}

export async function tickDueForUser(userId: string, limit = 2): Promise<{ ticked: number }> {
  const sql = await getSql();
  const rows = await sql<SourceDb>`
    select * from sources
    where user_id = ${userId}
      and (
        status in ('pending', 'syncing', 'rewriting')
        or (
          status = 'error'
          and coalesce(last_synced_at, '1970-01-01'::timestamptz) < now() - interval '2 minutes'
        )
        or (
          status = 'ready'
          and coalesce(last_synced_at, '1970-01-01'::timestamptz) < now() - interval '12 minutes'
        )
      )
    order by
      case status
        when 'syncing' then 0
        when 'rewriting' then 1
        when 'pending' then 2
        when 'error' then 3
        else 4
      end,
      last_synced_at asc nulls first
    limit ${limit}
  `;
  let ticked = 0;
  for (const row of rows) {
    await tickSource(userId, row.id);
    ticked += 1;
  }
  return { ticked };
}

