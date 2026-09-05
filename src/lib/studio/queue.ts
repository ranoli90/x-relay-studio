import {
  MAX_AHEAD,
  ORIGINAL_GAP_MIN,
  QUOTE_GAP_MIN,
  REPLY_GAP_MIN,
  assertManualQueueOnly,
  nextDue,
  parseMediaJson,
  pickOwnPhoto,
} from "./integrity.ts";

export type QueueSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type EnqueueResult = {
  queued: boolean;
  reason?: "cap" | "empty" | "dup" | "missing";
};

export type OriginalEnqueueInput = {
  userId: string;
  publisherId: string;
  maxAhead?: number;
  gapMin?: number;
  nowMs?: number;
};

export type WatchEnqueueInput = {
  userId: string;
  publisherId: string;
  kind: "reply" | "quote";
  body: string;
  watchPostId: string;
  replyToUrl: string | null;
  /** Own media only. Callers must not pass a photo from another post. */
  mediaUrl: string | null;
  maxAhead?: number;
  gapMin?: number;
  nowMs?: number;
};

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function lockPublisher(
  sql: QueueSql,
  userId: string,
  publisherId: string,
): Promise<boolean> {
  const rows = await sql.query<{ id: string }>(
    `select id from publishers where id = $1 and user_id = $2 for update`,
    [publisherId, userId],
  );
  return Boolean(rows[0]);
}

async function dueCount(sql: QueueSql, publisherId: string, kind: string): Promise<number> {
  const rows = await sql.query<{ n: unknown }>(
    `select count(*)::int as n from outbox
      where publisher_id = $1 and status = 'due' and kind = $2`,
    [publisherId, kind],
  );
  return asCount(rows[0]?.n);
}

/**
 * Atomic original enqueue. Publisher row is locked so concurrent ticks
 * cannot both pass the cap check. Unique (publisher, source_post) dedupes.
 * Status is always `due` — never `sent`.
 */
export async function enqueueOriginalAtomic(
  sql: QueueSql,
  input: OriginalEnqueueInput,
): Promise<EnqueueResult> {
  assertManualQueueOnly();
  const maxAhead = input.maxAhead ?? MAX_AHEAD;
  const gapMin = input.gapMin ?? ORIGINAL_GAP_MIN;
  const nowMs = input.nowMs ?? Date.now();

  if (!(await lockPublisher(sql, input.userId, input.publisherId))) {
    return { queued: false, reason: "missing" };
  }
  if ((await dueCount(sql, input.publisherId, "original")) >= maxAhead) {
    return { queued: false, reason: "cap" };
  }

  const next = await sql.query<{
    id: string;
    rewrite_text: string;
    text: string;
    media: unknown;
  }>(
    `select p.id, p.rewrite_text, p.text, p.media
       from posts p
       join sources s on s.id = p.source_id
      where s.publisher_id = $1
        and s.user_id = $2
        and p.rewrite_status = 'done'
        and coalesce(p.rewrite_text, '') <> ''
        and not exists (
          select 1 from outbox o
           where o.publisher_id = $1 and o.source_post_id = p.id
        )
      order by p.created_at asc nulls last
      limit 1`,
    [input.publisherId, input.userId],
  );
  if (!next[0]) return { queued: false, reason: "empty" };

  const mediaUrl = pickOwnPhoto(parseMediaJson(next[0].media));
  const last = await sql.query<{ due_at: string | null }>(
    `select max(due_at) as due_at from outbox where publisher_id = $1 and kind = 'original'`,
    [input.publisherId],
  );
  const due = nextDue(last[0]?.due_at, gapMin, nowMs);
  const id = crypto.randomUUID();
  const body = String(next[0].rewrite_text ?? "").slice(0, 280);

  try {
    const inserted = await sql.query<{ id: string }>(
      `insert into outbox (
         id, user_id, publisher_id, kind, status, body, media_url, source_post_id, due_at
       )
       select $1, $2, $3, 'original', 'due', $4, $5, $6, $7::timestamptz
        where (
          select count(*) from outbox
           where publisher_id = $3 and status = 'due' and kind = 'original'
        ) < $8
       returning id`,
      [id, input.userId, input.publisherId, body, mediaUrl, next[0].id, due, maxAhead],
    );
    if (!inserted[0]) return { queued: false, reason: "cap" };
  } catch {
    return { queued: false, reason: "dup" };
  }

  await sql.query(`update publishers set last_original_at = now() where id = $1 and user_id = $2`, [
    input.publisherId,
    input.userId,
  ]);
  return { queued: true };
}

/**
 * Atomic reply/quote enqueue after the LLM body is already written.
 * Does not attach unrelated scrape photos — mediaUrl must be the watch
 * post's own media or null.
 */
export async function enqueueWatchAtomic(
  sql: QueueSql,
  input: WatchEnqueueInput,
): Promise<EnqueueResult> {
  assertManualQueueOnly();
  const body = input.body.trim().slice(0, input.kind === "quote" ? 200 : 220);
  if (!body) return { queued: false, reason: "empty" };

  const maxAhead = input.maxAhead ?? MAX_AHEAD;
  const gapMin = input.gapMin ?? (input.kind === "quote" ? QUOTE_GAP_MIN : REPLY_GAP_MIN);
  const nowMs = input.nowMs ?? Date.now();

  if (!(await lockPublisher(sql, input.userId, input.publisherId))) {
    return { queued: false, reason: "missing" };
  }
  if ((await dueCount(sql, input.publisherId, input.kind)) >= maxAhead) {
    return { queued: false, reason: "cap" };
  }

  const last = await sql.query<{ due_at: string | null }>(
    `select max(due_at) as due_at from outbox where publisher_id = $1 and kind = $2`,
    [input.publisherId, input.kind],
  );
  const due = nextDue(last[0]?.due_at, gapMin, nowMs);
  const id = crypto.randomUUID();
  const stampCol = input.kind === "quote" ? "last_quote_at" : "last_reply_at";

  try {
    const inserted = await sql.query<{ id: string }>(
      `insert into outbox (
         id, user_id, publisher_id, kind, status, body, media_url, reply_to_url, watch_post_id, due_at
       )
       select $1, $2, $3, $4, 'due', $5, $6, $7, $8, $9::timestamptz
        where (
          select count(*) from outbox
           where publisher_id = $3 and status = 'due' and kind = $4
        ) < $10
          and not exists (
            select 1 from outbox o
             where o.publisher_id = $3 and o.watch_post_id = $8 and o.kind = $4
          )
       returning id`,
      [
        id,
        input.userId,
        input.publisherId,
        input.kind,
        body,
        input.mediaUrl,
        input.replyToUrl,
        input.watchPostId,
        due,
        maxAhead,
      ],
    );
    if (!inserted[0]) return { queued: false, reason: "cap" };
  } catch {
    return { queued: false, reason: "dup" };
  }

  await sql.query(`update publishers set ${stampCol} = now() where id = $1 and user_id = $2`, [
    input.publisherId,
    input.userId,
  ]);
  return { queued: true };
}

export { MAX_AHEAD, ORIGINAL_GAP_MIN, QUOTE_GAP_MIN, REPLY_GAP_MIN };
