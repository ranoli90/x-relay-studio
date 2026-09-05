import { getSql, withTransaction, type Sql } from "@/lib/db";
import { openRouterEnabled, studioTickEnabled, unofficialXLookupEnabled } from "@/lib/flags";
import { chatOpenRouter, extractJson } from "@/lib/openrouter.server";
import { STARTER_WATCH } from "@/lib/studio/handles";
import {
  MAX_AHEAD,
  ORIGINAL_GAP_MIN,
  QUOTE_GAP_MIN,
  REPLY_GAP_MIN,
  assertManualQueueOnly,
  fairSelect,
  mapOutboxStatus,
} from "@/lib/studio/integrity";
import { enqueueOriginalAtomic, enqueueWatchAtomic } from "@/lib/studio/queue";
import { fetchProfile } from "@/lib/x/fxtwitter.server";
import { searchAccountWindow } from "@/lib/x/search.server";
import type { LiveSnapshot, OutboxItem, OutboxKind, WatchHandle } from "./types";

const WATCH_CATCHUP_MIN = 12;
const MAX_WATCH_NEW = 3;
const PUBS_PER_TICK = 2;
const ORIGINALS_PER_TICK = 12;
const WATCHES_PER_TICK = 4;

type WatchRow = {
  id: string;
  handle: string;
  name: string;
  avatar: string | null;
  enabled: boolean;
  last_seen_at: string | null;
};

type OutboxRow = {
  id: string;
  publisher_id: string;
  kind: string;
  status: string;
  body: string;
  media_url: string | null;
  reply_to_url: string | null;
  due_at: string;
  sent_at: string | null;
};

type VoicePack = {
  handle: string;
  voice: string;
  topics: string[];
  samples: string[];
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

function mapKind(kind: string): OutboxKind {
  if (kind === "reply" || kind === "quote") return kind;
  return "original";
}

function mapWatch(row: WatchRow): WatchHandle {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    avatar: row.avatar,
    enabled: Boolean(row.enabled),
    lastSeenAt: row.last_seen_at,
  };
}

function mapOutbox(row: OutboxRow): OutboxItem {
  const dueMs = Date.parse(row.due_at);
  const status = mapOutboxStatus(row.status);
  return {
    id: row.id,
    publisherId: row.publisher_id,
    kind: mapKind(row.kind),
    status,
    body: row.body,
    mediaUrl: row.media_url,
    replyToUrl: row.reply_to_url,
    dueAt: row.due_at,
    sentAt: row.sent_at,
    readyNow: status === "due" && Number.isFinite(dueMs) && dueMs <= Date.now(),
    ack: status === "sent" ? "operator" : undefined,
  };
}

function isSafeWatchText(text: string): boolean {
  const t = text.trim();
  if (t.length < 24 || t.length > 420) return false;
  if ((t.match(/@/g) ?? []).length > 2) return false;
  if (/^\s*(rt[\s:]|retweet)/i.test(t)) return false;
  return true;
}

function dayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function listLive(userId: string, publisherId: string | null): Promise<LiveSnapshot> {
  const sql = await getSql();
  const watch = await sql<WatchRow>`
    select id, handle, name, avatar, enabled, last_seen_at
    from watch_handles where user_id = ${userId}
    order by created_at asc
  `;
  let outbox: OutboxRow[] = [];
  let dueCount = 0;
  let scheduledCount = 0;
  let sentToday = 0;
  if (publisherId) {
    outbox = await sql<OutboxRow>`
      select id, publisher_id, kind, status, body, media_url, reply_to_url, due_at, sent_at
      from outbox
      where user_id = ${userId} and publisher_id = ${publisherId}
      order by
        case status when 'due' then 0 when 'sent' then 1 else 2 end,
        due_at asc
      limit 60
    `;
    const since = dayStartIso();
    const counts = await sql<{ due: number; scheduled: number; sent: number }>`
      select
        (select count(*)::int from outbox
          where user_id = ${userId} and publisher_id = ${publisherId}
            and status = 'due' and due_at <= now()) as due,
        (select count(*)::int from outbox
          where user_id = ${userId} and publisher_id = ${publisherId}
            and status = 'due' and due_at > now()) as scheduled,
        (select count(*)::int from outbox
          where user_id = ${userId} and publisher_id = ${publisherId}
            and status = 'sent' and sent_at >= ${since}::timestamptz) as sent
    `;
    dueCount = Number(counts[0]?.due ?? 0) || 0;
    scheduledCount = Number(counts[0]?.scheduled ?? 0) || 0;
    sentToday = Number(counts[0]?.sent ?? 0) || 0;
  }
  return {
    watch: watch.map(mapWatch),
    outbox: outbox.map(mapOutbox),
    dueCount,
    scheduledCount,
    sentToday,
  };
}

export async function addWatchHandles(userId: string, handles: string[]): Promise<{ added: number; missing: string[] }> {
  if (!unofficialXLookupEnabled()) return { added: 0, missing: [...new Set(handles)] };
  const sql = await getSql();
  const unique = [...new Set(handles.map((h) => h.replace(/^@/, "").trim()).filter(Boolean))];
  let added = 0;
  const missing: string[] = [];
  for (const handle of unique) {
    const exists = await sql<{ id: string }>`
      select id from watch_handles where user_id = ${userId} and lower(handle) = ${handle.toLowerCase()} limit 1
    `;
    if (exists[0]) continue;
    const profile = await fetchProfile(handle);
    if (!profile) {
      missing.push(handle);
      continue;
    }
    await sql`
      insert into watch_handles (id, user_id, handle, name, avatar, enabled)
      values (${crypto.randomUUID()}, ${userId}, ${profile.handle}, ${profile.name}, ${profile.avatar ?? null}, true)
    `;
    added += 1;
  }
  return { added, missing };
}

export async function seedStarterWatch(userId: string): Promise<{ added: number; missing: string[] }> {
  if (!unofficialXLookupEnabled()) return { added: 0, missing: [] };
  const sql = await getSql();
  const existing = await sql<{ n: number }>`
    select count(*)::int as n from watch_handles where user_id = ${userId}
  `;
  if ((existing[0]?.n ?? 0) > 0) return { added: 0, missing: [] };
  return addWatchHandles(userId, [...STARTER_WATCH]);
}

export async function removeWatchHandles(userId: string, ids: string[]): Promise<void> {
  const sql = await getSql();
  for (const id of ids) {
    await sql`delete from watch_posts where watch_id = ${id} and user_id = ${userId}`;
    await sql`delete from watch_handles where id = ${id} and user_id = ${userId}`;
  }
}

export async function setDripEnabled(userId: string, publisherId: string, enabled: boolean): Promise<void> {
  const sql = await getSql();
  await sql`
    update publishers set drip_enabled = ${enabled}
    where id = ${publisherId} and user_id = ${userId}
  `;
}

/** Operator ack only. Does not post to X. */
export async function markOutbox(
  userId: string,
  ids: string[],
  status: "sent" | "skipped",
): Promise<void> {
  assertManualQueueOnly();
  const sql = await getSql();
  for (const id of ids) {
    await sql`
      update outbox set status = ${status}, sent_at = case when ${status} = 'sent' then now() else sent_at end
      where id = ${id} and user_id = ${userId} and status = 'due'
    `;
  }
}

async function loadVoice(sql: Sql, userId: string, publisherId: string): Promise<VoicePack | null> {
  const pub = await sql<{ handle: string }>`
    select handle from publishers where id = ${publisherId} and user_id = ${userId} limit 1
  `;
  if (!pub[0]) return null;
  const source = await sql<{ voice: unknown }>`
    select voice from sources
    where publisher_id = ${publisherId} and user_id = ${userId} and voice is not null
    order by rewritten desc
    limit 1
  `;
  const voice = asJson<{ voice?: string; topics?: string[] }>(source[0]?.voice, {});
  const samples = await sql<{ rewrite_text: string }>`
    select rewrite_text from posts
    where source_id in (select id from sources where publisher_id = ${publisherId})
      and rewrite_status = 'done' and coalesce(rewrite_text, '') <> ''
    order by created_at asc nulls last
    limit 6
  `;
  return {
    handle: pub[0].handle,
    voice: voice.voice ?? "Clear, specific, human.",
    topics: voice.topics ?? [],
    samples: samples.map((s) => s.rewrite_text),
  };
}

async function unusedWatchPost(
  sql: Sql,
  userId: string,
  publisherId: string,
  kind: "reply" | "quote",
): Promise<{ id: string; handle: string; url: string | null; text: string } | null> {
  const target = await sql<{ id: string; handle: string; url: string | null; text: string }>`
    select id, handle, url, text from watch_posts
    where user_id = ${userId}
      and coalesce(text, '') <> ''
      and not exists (
        select 1 from outbox o
        where o.publisher_id = ${publisherId}
          and o.watch_post_id = watch_posts.id
          and o.kind = ${kind}
      )
    order by created_at desc nulls last
    limit 16
  `;
  return target.find((t) => isSafeWatchText(t.text)) ?? null;
}

async function enqueueOriginal(userId: string, publisherId: string): Promise<boolean> {
  const result = await withTransaction(async (sql) =>
    enqueueOriginalAtomic(sql, { userId, publisherId, maxAhead: MAX_AHEAD }),
  );
  return result.queued;
}

async function writeTake(
  pack: VoicePack,
  targetHandle: string,
  targetText: string,
  mode: "reply" | "quote",
): Promise<string> {
  if (!openRouterEnabled()) return "";
  const system =
    mode === "quote"
      ? "Write one X quote-tweet. JSON only: {\"text\":\"...\"}. Under 200 characters. A specific take on the post, in the posting account's voice. No hashtags, no emoji stuffing, no 'this.', do not mention tools."
      : "Write one X reply. JSON only: {\"text\":\"...\"}. Under 220 characters. Add a specific thought. No hashtags, no emoji stuffing, no 'great post', do not mention you saw it via a tool.";
  const result = await chatOpenRouter({
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `Post as @${pack.handle}. Voice: ${pack.voice}\nTopics: ${pack.topics.join(", ")}\nVoice samples:\n${pack.samples.join("\n")}\n\n${mode === "quote" ? "Quote" : "Reply to"} @${targetHandle}: ${targetText}`,
      },
    ],
    json: true,
    maxTokens: 220,
    temperature: 0.5,
    timeoutMs: 25_000,
  });
  const rec = extractJson(result.text) as { text?: unknown };
  if (typeof rec.text !== "string") return "";
  return rec.text.trim().slice(0, mode === "quote" ? 200 : 220);
}

async function enqueueWatchKind(
  sql: Sql,
  userId: string,
  publisherId: string,
  kind: "reply" | "quote",
): Promise<boolean> {
  if (!openRouterEnabled()) return false;
  const safe = await unusedWatchPost(sql, userId, publisherId, kind);
  if (!safe) return false;
  const pack = await loadVoice(sql, userId, publisherId);
  if (!pack) return false;
  let body = "";
  try {
    body = await writeTake(pack, safe.handle, safe.text, kind);
  } catch {
    return false;
  }
  if (!body) return false;
  // Watch posts have no stored media. Do not attach a photo from the scrape pool.
  const result = await withTransaction(async (tx) =>
    enqueueWatchAtomic(tx, {
      userId,
      publisherId,
      kind,
      body,
      watchPostId: safe.id,
      replyToUrl: safe.url,
      mediaUrl: null,
      maxAhead: MAX_AHEAD,
    }),
  );
  return result.queued;
}

async function tickWatchHandle(sql: Sql, userId: string, watch: WatchRow): Promise<number> {
  if (!openRouterEnabled()) return 0;
  const found = await searchAccountWindow(watch.handle, {});
  let added = 0;
  for (const tweet of found.tweets.slice(0, MAX_WATCH_NEW + 4)) {
    if (!isSafeWatchText(tweet.text)) continue;
    try {
      const rows = await sql<{ id: string }>`
        insert into watch_posts (id, user_id, watch_id, tweet_id, url, handle, text, created_at)
        values (
          ${crypto.randomUUID()}, ${userId}, ${watch.id}, ${tweet.id}, ${tweet.url},
          ${watch.handle}, ${tweet.text.slice(0, 4000)}, ${tweet.createdAt ?? null}
        )
        on conflict (watch_id, tweet_id) do nothing
        returning id
      `;
      if (rows[0]) {
        added += 1;
        if (added >= MAX_WATCH_NEW) break;
      }
    } catch {
      const exists = await sql<{ id: string }>`
        select id from watch_posts where watch_id = ${watch.id} and tweet_id = ${tweet.id} limit 1
      `;
      if (exists[0]) continue;
      try {
        await sql`
          insert into watch_posts (id, user_id, watch_id, tweet_id, url, handle, text, created_at)
          values (
            ${crypto.randomUUID()}, ${userId}, ${watch.id}, ${tweet.id}, ${tweet.url},
            ${watch.handle}, ${tweet.text.slice(0, 4000)}, ${tweet.createdAt ?? null}
          )
        `;
        added += 1;
        if (added >= MAX_WATCH_NEW) break;
      } catch {
        /* duplicate under the unique index */
      }
    }
  }
  await sql`update watch_handles set last_seen_at = now() where id = ${watch.id} and user_id = ${userId}`;
  return added;
}

async function dueWatches(sql: Sql, userId: string, limit: number): Promise<WatchRow[]> {
  return sql<WatchRow>`
    select id, handle, name, avatar, enabled, last_seen_at
    from watch_handles
    where user_id = ${userId} and enabled = true
      and coalesce(last_seen_at, '1970-01-01'::timestamptz) < now() - interval '12 minutes'
    order by last_seen_at asc nulls first
    limit ${Math.max(limit, 1)}
  `;
}

async function duePublishers(sql: Sql, userId: string, limit: number): Promise<{ id: string }[]> {
  try {
    return await sql<{ id: string }>`
      select id from publishers
      where user_id = ${userId} and drip_enabled = true
      order by least(
        coalesce(last_original_at, '1970-01-01'::timestamptz),
        coalesce(last_reply_at, '1970-01-01'::timestamptz),
        coalesce(last_quote_at, '1970-01-01'::timestamptz)
      ) asc
      limit ${Math.max(limit, 1)}
    `;
  } catch {
    return sql<{ id: string }>`
      select id from publishers
      where user_id = ${userId} and drip_enabled = true
      order by created_at asc
      limit ${Math.max(limit, 1)}
    `;
  }
}

async function dueLiveUsers(sql: Sql, limit: number): Promise<{ user_id: string }[]> {
  const cap = Math.max(limit, 1);
  try {
    const rows = await sql<{ user_id: string }>`
      select user_id from (
        select user_id,
          min(least(
            coalesce(last_original_at, '1970-01-01'::timestamptz),
            coalesce(last_reply_at, '1970-01-01'::timestamptz),
            coalesce(last_quote_at, '1970-01-01'::timestamptz)
          )) as last_work
        from publishers
        where drip_enabled = true
        group by user_id
      ) t
      order by last_work asc
      limit ${cap * 4}
    `;
    return fairSelect(rows, cap);
  } catch {
    const rows = await sql<{ user_id: string }>`
      select distinct user_id from publishers where drip_enabled = true
      order by user_id
      limit ${cap * 4}
    `;
    return fairSelect(rows, cap);
  }
}

export async function tickLiveForUser(userId: string): Promise<{ watch: number; queued: number }> {
  if (!studioTickEnabled()) return { watch: 0, queued: 0 };
  assertManualQueueOnly();
  await seedStarterWatch(userId);
  const sql = await getSql();
  const dueWatch = await dueWatches(sql, userId, WATCHES_PER_TICK);
  let watch = 0;
  for (const row of dueWatch) {
    watch += await tickWatchHandle(sql, userId, row);
  }

  let queued = 0;
  const originalPubs = await duePublishers(sql, userId, ORIGINALS_PER_TICK);
  for (const pub of originalPubs) {
    if (await enqueueOriginal(userId, pub.id)) queued += 1;
  }
  const llmPubs = await duePublishers(sql, userId, PUBS_PER_TICK);
  for (const pub of llmPubs) {
    if (await enqueueWatchKind(sql, userId, pub.id, "reply")) queued += 1;
    if (await enqueueWatchKind(sql, userId, pub.id, "quote")) queued += 1;
  }
  return { watch, queued };
}

export async function fillQueue(
  userId: string,
  publisherId: string,
): Promise<{ queued: number; watch: number; seeded: number }> {
  if (!studioTickEnabled()) return { queued: 0, watch: 0, seeded: 0 };
  assertManualQueueOnly();
  const sql = await getSql();
  const owned = await sql<{ id: string }>`
    select id from publishers where id = ${publisherId} and user_id = ${userId} limit 1
  `;
  if (!owned[0]) return { queued: 0, watch: 0, seeded: 0 };
  const seeded = await seedStarterWatch(userId);
  let watch = 0;
  const dueWatch = await dueWatches(sql, userId, WATCHES_PER_TICK);
  for (const row of dueWatch) {
    watch += await tickWatchHandle(sql, userId, row);
  }
  let queued = 0;
  for (let i = 0; i < 3; i += 1) {
    if (await enqueueOriginal(userId, publisherId)) queued += 1;
    else break;
  }
  for (let i = 0; i < 3; i += 1) {
    if (await enqueueWatchKind(sql, userId, publisherId, "reply")) queued += 1;
    else break;
  }
  for (let i = 0; i < 3; i += 1) {
    if (await enqueueWatchKind(sql, userId, publisherId, "quote")) queued += 1;
    else break;
  }
  return { queued, watch, seeded: seeded.added };
}

export async function tickLiveAll(publisherLimit = 2): Promise<{ watch: number; queued: number }> {
  if (!studioTickEnabled()) return { watch: 0, queued: 0 };
  const sql = await getSql();
  const users = await dueLiveUsers(sql, Math.max(publisherLimit, 1));
  let watch = 0;
  let queued = 0;
  for (const row of users) {
    const res = await tickLiveForUser(row.user_id);
    watch += res.watch;
    queued += res.queued;
  }
  return { watch, queued };
}

export const DRIP = {
  originalEveryMin: ORIGINAL_GAP_MIN,
  replyEveryMin: REPLY_GAP_MIN,
  quoteEveryMin: QUOTE_GAP_MIN,
  watchEveryMin: WATCH_CATCHUP_MIN,
};
