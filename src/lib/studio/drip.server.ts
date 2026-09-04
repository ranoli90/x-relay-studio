import { getSql, type Sql } from "@/lib/db";
import { chatOpenRouter, extractJson } from "@/lib/openrouter.server";
import { STARTER_WATCH } from "@/lib/studio/handles";
import { fetchProfile } from "@/lib/x/fxtwitter.server";
import { searchAccountWindow } from "@/lib/x/search.server";
import type { MediaItem } from "@/lib/x/types";
import type { LiveSnapshot, OutboxItem, OutboxKind, OutboxStatus, WatchHandle } from "./types";

const ORIGINAL_GAP_MIN = 150; // ~10 originals / day
const REPLY_GAP_MIN = 60; // ~24 replies / day
const QUOTE_GAP_MIN = 180; // ~8 quotes / day
const WATCH_CATCHUP_MIN = 12;
const MAX_WATCH_NEW = 3;
const MAX_AHEAD = 8;
const PUBS_PER_TICK = 2;
const STOP = new Set(
  "the a an of to in for on with and or is it this that you we they i me my at as be by from not but if so just".split(
    " ",
  ),
);

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
  return {
    id: row.id,
    publisherId: row.publisher_id,
    kind: mapKind(row.kind),
    status: row.status === "sent" || row.status === "skipped" ? (row.status as OutboxStatus) : "due",
    body: row.body,
    mediaUrl: row.media_url,
    replyToUrl: row.reply_to_url,
    dueAt: row.due_at,
    sentAt: row.sent_at,
    readyNow: row.status === "due" && Number.isFinite(dueMs) && dueMs <= Date.now(),
  };
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9_]+/g)) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function isSafeWatchText(text: string): boolean {
  const t = text.trim();
  if (t.length < 24 || t.length > 420) return false;
  if ((t.match(/@/g) ?? []).length > 2) return false;
  if (/^\s*(rt[\s:]|retweet)/i.test(t)) return false;
  return true;
}

function pickPhoto(pool: { text: string; urls: string[] }[], needle: string): string | null {
  const withUrls = pool.filter((p) => p.urls.length > 0);
  if (!withUrls.length) return null;
  const want = tokens(needle);
  const matched = want.size
    ? withUrls.filter((p) => {
        const have = tokens(p.text);
        for (const w of want) if (have.has(w)) return true;
        return false;
      })
    : [];
  const pick = (matched.length ? matched : withUrls)[
    Math.floor(Math.random() * (matched.length ? matched.length : withUrls.length))
  ];
  if (!pick) return null;
  return pick.urls[Math.floor(Math.random() * pick.urls.length)] ?? null;
}

function dayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function nextDue(lastIso: string | null | undefined, gapMin: number): string {
  const gap = gapMin * 60 * 1000;
  const last = lastIso ? Date.parse(lastIso) : 0;
  const minStart = Number.isFinite(last) ? last + gap : Date.now();
  const due = Math.max(Date.now(), minStart);
  return new Date(due).toISOString();
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

export async function markOutbox(
  userId: string,
  ids: string[],
  status: "sent" | "skipped",
): Promise<void> {
  const sql = await getSql();
  for (const id of ids) {
    await sql`
      update outbox set status = ${status}, sent_at = case when ${status} = 'sent' then now() else sent_at end
      where id = ${id} and user_id = ${userId} and status = 'due'
    `;
  }
}

async function mediaPool(sql: Sql, userId: string, publisherId: string): Promise<{ text: string; urls: string[] }[]> {
  const rows = await sql<{ text: string; media: unknown; rewrite_text: string | null }>`
    select text, media, rewrite_text from posts
    where user_id = ${userId}
      and source_id in (select id from sources where publisher_id = ${publisherId} and user_id = ${userId})
      and media is not null
    order by created_at desc nulls last
    limit 400
  `;
  const pool: { text: string; urls: string[] }[] = [];
  for (const row of rows) {
    const media = asJson<MediaItem[]>(row.media, []);
    const urls = media.filter((m) => m.type === "photo" && m.url).map((m) => m.url);
    if (!urls.length) continue;
    pool.push({ text: `${row.rewrite_text ?? ""} ${row.text}`, urls });
  }
  return pool;
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

async function waitingKind(sql: Sql, publisherId: string, kind: OutboxKind): Promise<number> {
  const waiting = await sql<{ n: number }>`
    select count(*)::int as n from outbox
    where publisher_id = ${publisherId} and status = 'due' and kind = ${kind}
  `;
  return waiting[0]?.n ?? 0;
}

async function enqueueOriginal(sql: Sql, userId: string, publisherId: string): Promise<boolean> {
  if ((await waitingKind(sql, publisherId, "original")) >= MAX_AHEAD) return false;

  const next = await sql<{ id: string; rewrite_text: string; text: string }>`
    select p.id, p.rewrite_text, p.text
    from posts p
    join sources s on s.id = p.source_id
    where s.publisher_id = ${publisherId}
      and s.user_id = ${userId}
      and p.rewrite_status = 'done'
      and coalesce(p.rewrite_text, '') <> ''
      and not exists (
        select 1 from outbox o where o.publisher_id = ${publisherId} and o.source_post_id = p.id
      )
    order by p.created_at asc nulls last
    limit 1
  `;
  if (!next[0]) return false;
  const pool = await mediaPool(sql, userId, publisherId);
  const mediaUrl = pickPhoto(pool, next[0].rewrite_text || next[0].text);
  const last = await sql<{ due_at: string | null }>`
    select max(due_at) as due_at from outbox
    where publisher_id = ${publisherId} and kind = 'original'
  `;
  const due = nextDue(last[0]?.due_at, ORIGINAL_GAP_MIN);
  try {
    await sql`
      insert into outbox (id, user_id, publisher_id, kind, status, body, media_url, source_post_id, due_at)
      values (
        ${crypto.randomUUID()}, ${userId}, ${publisherId}, 'original', 'due',
        ${next[0].rewrite_text.slice(0, 280)}, ${mediaUrl}, ${next[0].id}, ${due}
      )
    `;
  } catch {
    return false;
  }
  await sql`update publishers set last_original_at = now() where id = ${publisherId} and user_id = ${userId}`;
  return true;
}

async function writeTake(
  pack: VoicePack,
  targetHandle: string,
  targetText: string,
  mode: "reply" | "quote",
): Promise<string> {
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
  if ((await waitingKind(sql, publisherId, kind)) >= MAX_AHEAD) return false;
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
  const pool = await mediaPool(sql, userId, publisherId);
  const mediaUrl = pickPhoto(pool, `${safe.text} ${body}`);
  const last = await sql<{ due_at: string | null }>`
    select max(due_at) as due_at from outbox
    where publisher_id = ${publisherId} and kind = ${kind}
  `;
  const due = nextDue(last[0]?.due_at, kind === "quote" ? QUOTE_GAP_MIN : REPLY_GAP_MIN);
  try {
    await sql`
      insert into outbox (
        id, user_id, publisher_id, kind, status, body, media_url, reply_to_url, watch_post_id, due_at
      ) values (
        ${crypto.randomUUID()}, ${userId}, ${publisherId}, ${kind}, 'due',
        ${body}, ${mediaUrl}, ${safe.url}, ${safe.id}, ${due}
      )
    `;
  } catch {
    return false;
  }
  if (kind === "quote") {
    await sql`update publishers set last_quote_at = now() where id = ${publisherId} and user_id = ${userId}`;
  } else {
    await sql`update publishers set last_reply_at = now() where id = ${publisherId} and user_id = ${userId}`;
  }
  return true;
}

async function tickWatchHandle(sql: Sql, userId: string, watch: WatchRow): Promise<number> {
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

export async function tickLiveForUser(userId: string): Promise<{ watch: number; queued: number }> {
  await seedStarterWatch(userId);
  const sql = await getSql();
  const dueWatch = await dueWatches(sql, userId, 2);
  let watch = 0;
  for (const row of dueWatch) {
    watch += await tickWatchHandle(sql, userId, row);
  }

  const pubs = await duePublishers(sql, userId, PUBS_PER_TICK);
  let queued = 0;
  for (const pub of pubs) {
    if (await enqueueOriginal(sql, userId, pub.id)) queued += 1;
    if (await enqueueWatchKind(sql, userId, pub.id, "reply")) queued += 1;
    if (await enqueueWatchKind(sql, userId, pub.id, "quote")) queued += 1;
  }
  return { watch, queued };
}

export async function fillQueue(
  userId: string,
  publisherId: string,
): Promise<{ queued: number; watch: number; seeded: number }> {
  const sql = await getSql();
  const owned = await sql<{ id: string }>`
    select id from publishers where id = ${publisherId} and user_id = ${userId} limit 1
  `;
  if (!owned[0]) return { queued: 0, watch: 0, seeded: 0 };
  const seeded = await seedStarterWatch(userId);
  let watch = 0;
  const dueWatch = await dueWatches(sql, userId, 2);
  for (const row of dueWatch) {
    watch += await tickWatchHandle(sql, userId, row);
  }
  let queued = 0;
  for (let i = 0; i < 3; i += 1) {
    if (await enqueueOriginal(sql, userId, publisherId)) queued += 1;
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
  const sql = await getSql();
  let users: { user_id: string }[] = [];
  try {
    users = await sql<{ user_id: string }>`
      select distinct user_id from (
        select user_id from publishers where drip_enabled = true
        union
        select user_id from watch_handles where enabled = true
      ) u
      limit ${Math.max(publisherLimit, 1)}
    `;
  } catch {
    users = await sql<{ user_id: string }>`
      select distinct user_id from publishers where drip_enabled = true
      limit ${Math.max(publisherLimit, 1)}
    `;
  }
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
