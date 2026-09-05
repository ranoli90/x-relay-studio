import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { enqueueOriginalAtomic, enqueueWatchAtomic } from "./queue.ts";
import type { QueueSql } from "./queue.ts";

function toSql(pg: { query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> }): QueueSql {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

async function setup() {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    create table publishers (
      id text primary key,
      user_id text not null,
      handle text not null default 'pub',
      name text not null default 'Pub',
      last_original_at timestamptz,
      last_reply_at timestamptz,
      last_quote_at timestamptz
    );
    create table sources (
      id text primary key,
      user_id text not null,
      publisher_id text not null,
      handle text not null default 'src'
    );
    create table posts (
      id text primary key,
      user_id text not null,
      source_id text not null,
      tweet_id text not null,
      text text not null default '',
      rewrite_text text,
      rewrite_status text not null default 'done',
      media jsonb,
      created_at timestamptz
    );
    create table outbox (
      id text primary key,
      user_id text not null,
      publisher_id text not null,
      kind text not null,
      status text not null default 'due',
      body text not null,
      media_url text,
      reply_to_url text,
      source_post_id text,
      watch_post_id text,
      due_at timestamptz not null default now(),
      sent_at timestamptz
    );
    create unique index outbox_source_once_idx
      on outbox (publisher_id, source_post_id) where source_post_id is not null;
    create unique index outbox_watch_kind_once_idx
      on outbox (publisher_id, watch_post_id, kind) where watch_post_id is not null;
  `);
  return pg;
}

async function seedPublisher(
  pg: PGlite,
  opts: { userId: string; publisherId: string; sourceId: string; posts: number },
) {
  await pg.query(`insert into publishers (id, user_id) values ($1, $2)`, [opts.publisherId, opts.userId]);
  await pg.query(`insert into sources (id, user_id, publisher_id) values ($1, $2, $3)`, [
    opts.sourceId,
    opts.userId,
    opts.publisherId,
  ]);
  for (let i = 0; i < opts.posts; i += 1) {
    const media =
      i === 0
        ? JSON.stringify([{ type: "photo", url: "https://cdn.example/own-0.jpg" }])
        : JSON.stringify([{ type: "photo", url: `https://cdn.example/other-${i}.jpg` }]);
    await pg.query(
      `insert into posts (id, user_id, source_id, tweet_id, text, rewrite_text, rewrite_status, media, created_at)
       values ($1, $2, $3, $4, $5, $6, 'done', $7::jsonb, $8::timestamptz)`,
      [
        `${opts.sourceId}-p${i}`,
        opts.userId,
        opts.sourceId,
        `${opts.sourceId}-t${i}`,
        i === 0 ? "own photo post about cats" : `unrelated post ${i} dogs`,
        `rewrite ${i}`,
        media,
        new Date(Date.UTC(2024, 0, i + 1)).toISOString(),
      ],
    );
  }
}

describe("XR-045 atomic queue + caps", () => {
  it("concurrent ticks honor the ahead cap and dedupe source posts", async () => {
    const pg = await setup();
    await seedPublisher(pg, { userId: "desk_a", publisherId: "pub_a", sourceId: "src_a", posts: 6 });

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        pg.transaction(async (tx) => enqueueOriginalAtomic(toSql(tx), { userId: "desk_a", publisherId: "pub_a", maxAhead: 2 })),
      ),
    );
    const queued = results.filter((r) => r.queued).length;
    const rows = await pg.query<{ n: number; statuses: string }>(
      `select count(*)::int as n from outbox where publisher_id = 'pub_a'`,
    );
    const sent = await pg.query<{ n: number }>(
      `select count(*)::int as n from outbox where status = 'sent'`,
    );
    assert.ok(queued <= 2);
    assert.equal(Number(rows.rows[0]?.n ?? 0), queued);
    assert.ok(Number(rows.rows[0]?.n ?? 0) <= 2);
    assert.equal(Number(sent.rows[0]?.n ?? 0), 0);

    const ids = await pg.query<{ source_post_id: string }>(`select source_post_id from outbox`);
    const unique = new Set(ids.rows.map((r) => r.source_post_id));
    assert.equal(unique.size, ids.rows.length);
    await pg.close();
  });

  it("sequential overflow stops at the cap", async () => {
    const pg = await setup();
    await seedPublisher(pg, { userId: "desk_a", publisherId: "pub_a", sourceId: "src_a", posts: 5 });
    let queued = 0;
    for (let i = 0; i < 5; i += 1) {
      const result = await pg.transaction(async (tx) =>
        enqueueOriginalAtomic(toSql(tx), { userId: "desk_a", publisherId: "pub_a", maxAhead: 3 }),
      );
      if (result.queued) queued += 1;
      else assert.equal(result.reason, "cap");
    }
    assert.equal(queued, 3);
    const n = await pg.query<{ n: number }>(`select count(*)::int as n from outbox`);
    assert.equal(Number(n.rows[0]?.n ?? 0), 3);
    await pg.close();
  });

  it("does not attach another post's photo", async () => {
    const pg = await setup();
    await seedPublisher(pg, { userId: "desk_a", publisherId: "pub_a", sourceId: "src_a", posts: 3 });
    const result = await pg.transaction(async (tx) =>
      enqueueOriginalAtomic(toSql(tx), { userId: "desk_a", publisherId: "pub_a", maxAhead: 1 }),
    );
    assert.equal(result.queued, true);
    const row = (await pg.query<{ media_url: string | null; body: string }>(`select media_url, body from outbox`))
      .rows[0];
    assert.equal(row.body, "rewrite 0");
    assert.equal(row.media_url, "https://cdn.example/own-0.jpg");
    await pg.close();
  });

  it("watch enqueue is deduped per kind and stays due", async () => {
    const pg = await setup();
    await pg.query(`insert into publishers (id, user_id) values ('pub_a', 'desk_a')`);
    const first = await pg.transaction(async (tx) =>
      enqueueWatchAtomic(toSql(tx), {
        userId: "desk_a",
        publisherId: "pub_a",
        kind: "reply",
        body: "a specific take",
        watchPostId: "watch_1",
        replyToUrl: "https://x.com/naval/status/1",
        mediaUrl: null,
        maxAhead: 2,
      }),
    );
    const dup = await pg.transaction(async (tx) =>
      enqueueWatchAtomic(toSql(tx), {
        userId: "desk_a",
        publisherId: "pub_a",
        kind: "reply",
        body: "another take",
        watchPostId: "watch_1",
        replyToUrl: "https://x.com/naval/status/1",
        mediaUrl: "https://cdn.example/unrelated.jpg",
        maxAhead: 2,
      }),
    );
    assert.equal(first.queued, true);
    assert.equal(dup.queued, false);
    const rows = await pg.query<{ status: string; media_url: string | null }>(`select status, media_url from outbox`);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].status, "due");
    assert.equal(rows.rows[0].media_url, null);
    await pg.close();
  });
});
