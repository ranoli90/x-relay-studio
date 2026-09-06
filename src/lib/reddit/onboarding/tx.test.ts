import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createOrReuseDraft } from "./store.ts";
import { sqlFromPool, withSqlTransaction, type SqlLike } from "./sql.ts";
import { OnboardingError } from "./types.ts";
import { schema, toSql } from "./test-schema.ts";

type LoggedQuery = { id: string; sql: string };

function createTaggedPool(size = 3) {
  const log: LoggedQuery[] = [];
  const idle: Array<{
    id: string;
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    release: (err?: boolean | Error) => void;
  }> = [];

  function makeClient(id: string) {
    const client = {
      id,
      query: async (text: string, _params?: unknown[]) => {
        log.push({ id, sql: text });
        return { rows: [] as unknown[] };
      },
      release: (_err?: boolean | Error) => {
        idle.push(client);
      },
    };
    return client;
  }

  for (let i = 0; i < size; i++) idle.push(makeClient(`c${i}`));

  const pool = {
    connect: async () => {
      const client = idle.shift();
      if (!client) throw new Error("pool exhausted");
      return client;
    },
    query: async (text: string, _params?: unknown[]) => {
      log.push({ id: "pool", sql: text });
      return { rows: [] as unknown[] };
    },
  };

  return { pool, log };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function wrappingSql(inner: SqlLike, afterInsert: string): SqlLike {
  return {
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const rows = await inner.query<T>(text, params);
      if (new RegExp(`insert into ${afterInsert}\\b`, "i").test(text)) {
        throw new Error(`injected failure after ${afterInsert} insert`);
      }
      return rows;
    },
  };
}

describe("sql transaction affinity (RC-001)", () => {
  it("keeps BEGIN, inserts, and COMMIT on the same checked-out connection", async () => {
    const { pool, log } = createTaggedPool(3);
    const sql = sqlFromPool(pool);
    await withSqlTransaction(sql, async (tx) => {
      await tx.query("insert into reddit_onboarding_jobs (id) values ($1)", ["job-1"]);
      await tx.query("insert into reddit_onboarding_commands (id) values ($1)", ["cmd-1"]);
      await sql.query("insert into reddit_onboarding_events (id) values ($1)", ["evt-1"]);
    });
    const pinned = log.filter((row) => row.id !== "pool");
    assert.ok(pinned.length >= 4);
    const id = pinned[0]?.id;
    assert.ok(id);
    assert.ok(pinned.every((row) => row.id === id));
    assert.match(pinned[0].sql, /^begin$/i);
    assert.match(pinned[pinned.length - 1].sql, /^commit$/i);
    assert.equal(log.filter((row) => /^begin$/i.test(row.sql.trim())).length, 1);
    assert.equal(log.filter((row) => /^commit$/i.test(row.sql.trim())).length, 1);
  });

  it("reuses the same connection for nested withSqlTransaction", async () => {
    const { pool, log } = createTaggedPool(3);
    const sql = sqlFromPool(pool);
    await withSqlTransaction(sql, async (tx) => {
      await tx.query("insert into reddit_onboarding_jobs (id) values ($1)", ["outer"]);
      await withSqlTransaction(tx, async (inner) => {
        await inner.query("insert into reddit_onboarding_commands (id) values ($1)", ["nested"]);
      });
      await tx.query("insert into reddit_onboarding_events (id) values ($1)", ["after"]);
    });
    const pinned = log.filter((row) => row.id !== "pool");
    const id = pinned[0]?.id;
    assert.ok(id);
    assert.ok(pinned.every((row) => row.id === id));
    assert.equal(log.filter((row) => /^begin$/i.test(row.sql.trim())).length, 1);
    assert.equal(log.filter((row) => /^commit$/i.test(row.sql.trim())).length, 1);
  });

  it("does not share a connection across concurrent transactions", async () => {
    const { pool, log } = createTaggedPool(3);
    const sql = sqlFromPool(pool);
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const run = Promise.all([
      withSqlTransaction(sql, async (tx) => {
        await tx.query("insert into reddit_onboarding_jobs (id) values ($1)", ["job-a"]);
        releaseFirst();
        await secondReady;
        await tx.query("insert into reddit_onboarding_commands (id) values ($1)", ["cmd-a"]);
      }),
      withSqlTransaction(sql, async (tx) => {
        await firstReady;
        await tx.query("insert into reddit_onboarding_jobs (id) values ($1)", ["job-b"]);
        releaseSecond();
        await tx.query("insert into reddit_onboarding_commands (id) values ($1)", ["cmd-b"]);
      }),
    ]);

    await withTimeout(run, 2000, "concurrent transactions deadlocked — connections were shared");

    const begins = log.filter((row) => /^begin$/i.test(row.sql.trim()));
    assert.equal(begins.length, 2);
    assert.notEqual(begins[0]?.id, begins[1]?.id);
    const byConn = new Map<string, string[]>();
    for (const row of log.filter((entry) => entry.id !== "pool")) {
      const list = byConn.get(row.id) ?? [];
      list.push(row.sql);
      byConn.set(row.id, list);
    }
    assert.equal(byConn.size, 2);
    for (const statements of byConn.values()) {
      assert.match(statements[0] ?? "", /^begin$/i);
      assert.match(statements[statements.length - 1] ?? "", /^commit$/i);
    }
  });
});

describe("atomic draft writes (RC-002)", () => {
  for (const table of ["reddit_onboarding_jobs", "reddit_onboarding_commands", "reddit_onboarding_events"]) {
    it(`rolls back a failed draft after ${table} insert`, async () => {
      const pg = new PGlite();
      await pg.waitReady;
      await schema(pg);
      const inner = toSql(pg);
      const sql = wrappingSql(inner, table);
      await assert.rejects(
        () =>
          createOrReuseDraft(sql, {
            userId: "user-a",
            mode: "manual",
            intent: "create",
            idempotencyKey: `fail-${table}`,
            body: { table },
          }),
        /injected failure/,
      );
      const jobs = await inner.query(`select id from reddit_onboarding_jobs`);
      const commands = await inner.query(`select id from reddit_onboarding_commands`);
      const events = await inner.query(`select id from reddit_onboarding_events`);
      assert.equal(jobs.length, 0, "no leftover jobs");
      assert.equal(commands.length, 0, "no leftover commands");
      assert.equal(events.length, 0, "no leftover events");
      await pg.close();
    });
  }
});

describe("draft idempotency (RC-003)", () => {
  it("reuses the same job for the same key and body", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const first = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "same-key",
      body: { mode: "manual", intent: "create" },
    });
    const second = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "same-key",
      body: { mode: "manual", intent: "create" },
    });
    assert.equal(second.reused, true);
    assert.equal(second.job.id, first.job.id);
    const jobs = await sql.query(`select id from reddit_onboarding_jobs where user_id = $1`, ["user-a"]);
    assert.equal(jobs.length, 1);
    await pg.close();
  });

  it("conflicts when the same key is reused with a different body", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const first = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "conflict-key",
      body: { mode: "manual", intent: "create" },
    });
    await assert.rejects(
      () =>
        createOrReuseDraft(sql, {
          userId: "user-a",
          mode: "assisted",
          intent: "create",
          idempotencyKey: "conflict-key",
          body: { mode: "assisted", intent: "create" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof OnboardingError);
        assert.equal(err.code, "IDEMPOTENCY_CONFLICT");
        return true;
      },
    );
    const jobs = await sql.query<{ id: string; mode: string }>(
      `select id, mode from reddit_onboarding_jobs where user_id = $1`,
      ["user-a"],
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, first.job.id);
    assert.equal(jobs[0]?.mode, "manual");
    await pg.close();
  });
});
