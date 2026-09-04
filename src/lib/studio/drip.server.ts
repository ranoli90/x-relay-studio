import { getSql, type Sql } from "@/lib/db";
import { chatOpenRouter, extractJson } from "@/lib/openrouter.server";
import { fetchProfile } from "@/lib/x/fxtwitter.server";
import { searchAccountWindow } from "@/lib/x/search.server";
import type { MediaItem } from "@/lib/x/types";
import type { LiveSnapshot, OutboxItem, OutboxKind, OutboxStatus, WatchHandle } from "./types";

const ORIGINAL_GAP_MIN = 150; // ~10 originals / day
const REPLY_GAP_MIN = 60; // ~24 replies / day
const WATCH_CATCHUP_MIN = 12;
const MAX_WATCH_NEW = 3;
const MAX_AHEAD = 8;
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
  return {
    id: row.id,
    publisherId: row.publisher_id,
    kind: row.kind === "reply" ? "reply" : "original",
    status: row.status === "sent" || row.status === "skipped" ? (row.status as OutboxStatus) : "due",
    body: row.body,
    mediaUrl: row.media_url,
    replyToUrl: row.reply_to_url,
    dueAt: row.due_at,
    sentAt: row.sent_at,
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
  const pick = (matched.length ? matched : withUrls)[Math.floor(Math.random() * (matched.length ? matched.length : withUrls.length))];
  if (!pick) return null;
  return pick.urls[Math.floor(Math.random() * pick.urls.length)] ?? null;
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
    const counts = await sql<{ due: number; sent: number }>`
      select
        (select count(*)::int from outbox where user_id = ${userId} and publisher_id = ${publisherId} and status = 'due') as due,
        (select count(*)::int from outbox where user_id = ${userId} and publisher_id = ${publisherId} and status = 'sent' and sent_at >= date_trunc('day', now())) as sent
    `;
    dueCount = Number(counts[0]?.due ?? 0) || 0;
    sentToday = Number(counts[0]?.sent ?? 0) || 0;
  }
  return {
    watch: watch.map(mapWatch),
    outbox: outbox.map(mapOutbox),
    dueCount,
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

async function enqueueOriginal(sql: Sql, userId: string, publisherId: string): Promise<boolean> {
  const waiting = await sql<{ n: number }>`
    select count(*)::int as n from outbox
    where publisher_id = ${publisherId} and status = 'due' and kind = 'original'
  `;
  if ((waiting[0]?.n ?? 0) >= MAX_AHEAD) return false;

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

async function enqueueReply(sql: Sql, userId: string, publisherId: string): Promise<boolean> {
  const waiting = await sql<{ n: number }>`
    select count(*)::int as n from outbox
    where publisher_id = ${publisherId} and status = 'due' and kind = 'reply'
  `;
  if ((waiting[0]?.n ?? 0) >= MAX_AHEAD) return false;

  const target = await sql<{ id: string; handle: string; url: string | null; text: string }>`
    select id, handle, url, text from watch_posts
    where user_id = ${userId}
      and coalesce(text, '') <> ''
      and not exists (
        select 1 from outbox o where o.publisher_id = ${publisherId} and o.watch_post_id = watch_posts.id
      )
    order by created_at desc nulls last
    limit 12
  `;
  const safe = target.find((t) => isSafeWatchText(t.text));
  if (!safe) return false;

  const pub = await sql<{ handle: string; kit: unknown }>`
    select handle, kit from publishers where id = ${publisherId} and user_id = ${userId} limit 1
  `;
  if (!pub[0]) return false;
  const source = await sql<{ voice: unknown; handle: string }>`
    select voice, handle from sources
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

  let body = "";
  try {
    const result = await chatOpenRouter({
      messages: [
        {
          role: "system",
          content:
            "Write one X reply. JSON only: {\"text\":\"...\"}. Under 220 characters. Add a specific thought. No hashtags, no emoji stuffing, no 'great post', do not mention you saw it via a tool.",
        },
        {
          role: "user",
          content: `Post as @${pub[0].handle}. Voice: ${voice.voice ?? "Clear, specific, human."}\nTopics: ${(voice.topics ?? []).join(", ")}\nVoice samples:\n${samples.map((s) => s.rewrite_text).join("\n")}\n\nReply to @${safe.handle}: ${safe.text}`,
        },
      ],
      json: true,
      maxTokens: 220,
      temperature: 0.5,
      timeoutMs: 25_000,
    });
    const rec = extractJson(result.text) as { text?: unknown };
    if (typeof rec.text === "string") body = rec.text.trim().slice(0, 220);
  } catch {
    return false;
  }
  if (!body) return false;

  const pool = await mediaPool(sql, userId, publisherId);
  const mediaUrl = pickPhoto(pool, `${safe.text} ${body}`);
  const last = await sql<{ due_at: string | null }>`
    select max(due_at) as due_at from outbox
    where publisher_id = ${publisherId} and kind = 'reply'
  `;
  const due = nextDue(last[0]?.due_at, REPLY_GAP_MIN);
  try {
    await sql`
      insert into outbox (
        id, user_id, publisher_id, kind, status, body, media_url, reply_to_url, watch_post_id, due_at
      ) values (
        ${crypto.randomUUID()}, ${userId}, ${publisherId}, 'reply', 'due',
        ${body}, ${mediaUrl}, ${safe.url}, ${safe.id}, ${due}
      )
    `;
  } catch {
    return false;
  }
  await sql`update publishers set last_reply_at = now() where id = ${publisherId} and user_id = ${userId}`;
  return true;
}

function nextDue(lastIso: string | null | undefined, gapMin: number): string {
  const gap = gapMin * 60 * 1000;
  const last = lastIso ? Date.parse(lastIso) : 0;
  const minStart = Number.isFinite(last) ? last + gap : Date.now();
  const due = Math.max(Date.now(), minStart);
  return new Date(due).toISOString();
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
      await sql`
        insert into watch_posts (id, user_id, watch_id, tweet_id, url, handle, text, created_at)
        values (
          ${crypto.randomUUID()}, ${userId}, ${watch.id}, ${tweet.id}, ${tweet.url},
          ${watch.handle}, ${tweet.text.slice(0, 4000)}, ${tweet.createdAt ?? null}
        )
      `;
      added += 1;
      if (added >= MAX_WATCH_NEW) break;
    }
  }
  await sql`update watch_handles set last_seen_at = now() where id = ${watch.id} and user_id = ${userId}`;
  return added;
}

export async function tickLiveForUser(userId: string): Promise<{ watch: number; queued: number }> {
  const sql = await getSql();
  const dueWatch = await sql<WatchRow>`
    select id, handle, name, avatar, enabled, last_seen_at
    from watch_handles
    where user_id = ${userId} and enabled = true
      and coalesce(last_seen_at, '1970-01-01'::timestamptz) < now() - interval '12 minutes'
    order by last_seen_at asc nulls first
    limit 2
  `;
  let watch = 0;
  for (const row of dueWatch) {
    watch += await tickWatchHandle(sql, userId, row);
  }

  const pubs = await sql<{ id: string; drip_enabled: boolean }>`
    select id, drip_enabled from publishers
    where user_id = ${userId} and drip_enabled = true
    order by created_at asc
  `;
  let queued = 0;
  for (const pub of pubs) {
    if (await enqueueOriginal(sql, userId, pub.id)) queued += 1;
    if (await enqueueReply(sql, userId, pub.id)) queued += 1;
  }
  return { watch, queued };
}

export async function tickLiveAll(publisherLimit = 2): Promise<{ watch: number; queued: number }> {
  const sql = await getSql();
  const users = await sql<{ user_id: string }>`
    select distinct user_id from publishers where drip_enabled = true
    union
    select distinct user_id from watch_handles where enabled = true
    limit ${Math.max(publisherLimit, 1)}
  `;
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
  watchEveryMin: WATCH_CATCHUP_MIN,
};
