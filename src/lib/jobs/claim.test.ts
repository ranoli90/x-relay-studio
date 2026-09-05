import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { claimDueJobs, finalizeJob, MAX_JOB_ATTEMPTS, type ClaimedJob } from "./claim.ts";
import { ensureSlaTicket } from "./tickets.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

const JOB_SCHEMA = `
  create table agent_jobs (
    id text primary key, user_id text not null, thread_id text, kind text not null,
    run_at timestamptz, payload text, status text, done_at timestamptz,
    claim_token text, claim_until timestamptz, attempt_count integer, last_error text
  );
`;

const TICKET_SCHEMA = `
  create table agent_tickets (
    id text primary key, user_id text not null, thread_id text, offer_id text,
    kind text not null, body text not null, status text not null default 'open',
    created_at timestamptz not null default now()
  );
  create unique index agent_tickets_sla_offer_uidx
    on agent_tickets (offer_id)
    where kind = 'sla' and offer_id is not null;
`;

/**
 * PGlite may not honor `for update skip locked` across concurrent sessions the
 * way Postgres does (single in-process backend). If the production claim SQL
 * errors, fence via claim_token / claim_until updates instead.
 */
async function claimDueJobsOrFence(
  sql: ReturnType<typeof toSql>,
  token: string,
  opts?: { userId?: string; limit?: number },
): Promise<{ rows: ClaimedJob[]; skipLocked: boolean }> {
  try {
    const rows = await claimDueJobs(sql, token, opts);
    return { rows, skipLocked: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/skip locked|for update/i.test(msg)) throw err;
    const limit = opts?.limit ?? 20;
    const rows = opts?.userId
      ? await sql.query<ClaimedJob>(
          `update agent_jobs
              set claim_token = $1,
                  claim_until = now() + interval '2 minutes',
                  status = 'claimed',
                  attempt_count = coalesce(attempt_count, 0) + 1
            where id in (
              select id from agent_jobs
               where done_at is null
                 and run_at <= now()
                 and (claim_until is null or claim_until <= now())
                 and coalesce(status, 'pending') not in ('dead', 'succeeded')
                 and user_id = $2
               order by run_at
               limit $3
            )
            returning id, user_id, thread_id, kind, claim_token`,
          [token, opts.userId, limit],
        )
      : await sql.query<ClaimedJob>(
          `update agent_jobs
              set claim_token = $1,
                  claim_until = now() + interval '2 minutes',
                  status = 'claimed',
                  attempt_count = coalesce(attempt_count, 0) + 1
            where id in (
              select id from agent_jobs
               where done_at is null
                 and run_at <= now()
                 and (claim_until is null or claim_until <= now())
                 and coalesce(status, 'pending') not in ('dead', 'succeeded')
               order by run_at
               limit $2
            )
            returning id, user_id, thread_id, kind, claim_token`,
          [token, limit],
        );
    return { rows, skipLocked: false };
  }
}

describe("F15 job claims", () => {
  it("competing claims: two tokens, one row", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(JOB_SCHEMA);
    await pg.exec(`
      insert into agent_jobs (id, user_id, kind, run_at, status)
        values ('job_1', 'desk_a', 'check_in', now() - interval '1 second', 'pending');
    `);
    const sql = toSql(pg);
    const first = await claimDueJobsOrFence(sql, "token_a", { limit: 5 });
    const second = await claimDueJobsOrFence(sql, "token_b", { limit: 5 });
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0]?.claim_token, "token_a");
    assert.equal(second.rows.length, 0);
    const row = (
      await pg.query<{ claim_token: string; status: string }>(
        "select claim_token, status from agent_jobs",
      )
    ).rows[0];
    assert.equal(row.claim_token, "token_a");
    assert.equal(row.status, "claimed");
    await pg.close();
  });

  it("finalize requires the claim token; a stale worker cannot succeed", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(JOB_SCHEMA);
    await pg.exec(`
      insert into agent_jobs (id, user_id, kind, run_at, status)
        values ('job_1', 'desk_a', 'check_in', now() - interval '1 second', 'pending');
    `);
    const sql = toSql(pg);
    const claimed = await claimDueJobsOrFence(sql, "token_a", { limit: 5 });
    assert.equal(claimed.rows.length, 1);
    const stale = await finalizeJob(sql, "job_1", "token_old", { ok: true });
    assert.equal(stale, false);
    const live = await finalizeJob(sql, "job_1", "token_a", { ok: true });
    assert.equal(live, true);
    const row = (
      await pg.query<{ status: string; done_at: string | null }>(
        "select status, done_at from agent_jobs",
      )
    ).rows[0];
    assert.equal(row.status, "succeeded");
    assert.ok(row.done_at);
    await pg.close();
  });

  it("failed job is retry_wait not succeeded", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(JOB_SCHEMA);
    await pg.exec(`
      insert into agent_jobs (id, user_id, kind, run_at, status, attempt_count)
        values ('job_1', 'desk_a', 'check_in', now() - interval '1 second', 'pending', 0);
    `);
    const sql = toSql(pg);
    const claimed = await claimDueJobsOrFence(sql, "token_a", { limit: 5 });
    assert.equal(claimed.rows.length, 1);
    const failed = await finalizeJob(sql, "job_1", "token_a", { ok: false, error: "writer down" });
    assert.equal(failed, true);
    const row = (
      await pg.query<{ status: string; done_at: string | null; last_error: string | null }>(
        "select status, done_at, last_error from agent_jobs",
      )
    ).rows[0];
    assert.equal(row.status, "retry_wait");
    assert.equal(row.done_at, null);
    assert.equal(row.last_error, "writer down");
    const stolen = await finalizeJob(sql, "job_1", "token_a", { ok: true });
    assert.equal(stolen, false);
    await pg.close();
  });

  it("expired claim can be taken by a new token", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(JOB_SCHEMA);
    await pg.exec(`
      insert into agent_jobs (id, user_id, kind, run_at, status)
        values ('job_1', 'desk_a', 'check_in', now() - interval '1 second', 'pending');
    `);
    const sql = toSql(pg);
    const first = await claimDueJobsOrFence(sql, "token_a", { limit: 5 });
    assert.equal(first.rows.length, 1);
    await pg.exec(`update agent_jobs set claim_until = now() - interval '1 second'`);
    const second = await claimDueJobsOrFence(sql, "token_b", { limit: 5 });
    assert.equal(second.rows.length, 1);
    assert.equal(second.rows[0]?.claim_token, "token_b");
    const stale = await finalizeJob(sql, "job_1", "token_a", { ok: true });
    assert.equal(stale, false);
    const live = await finalizeJob(sql, "job_1", "token_b", { ok: true });
    assert.equal(live, true);
    await pg.close();
  });

  it("after max attempts a failure is terminal dead, not infinite retry_wait", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(JOB_SCHEMA);
    await pg.exec(`
      insert into agent_jobs (id, user_id, kind, run_at, status, attempt_count)
        values ('job_1', 'desk_a', 'check_in', now() - interval '1 second', 'pending', ${MAX_JOB_ATTEMPTS - 1});
    `);
    const sql = toSql(pg);
    const claimed = await claimDueJobsOrFence(sql, "token_a", { limit: 5 });
    assert.equal(claimed.rows.length, 1);
    const failed = await finalizeJob(sql, "job_1", "token_a", { ok: false, error: "still boom" });
    assert.equal(failed, true);
    const row = (
      await pg.query<{ status: string; done_at: string | null; last_error: string | null }>(
        "select status, done_at, last_error from agent_jobs",
      )
    ).rows[0];
    assert.equal(row.status, "dead");
    assert.equal(row.done_at, null);
    assert.equal(row.last_error, "still boom");
    const again = await claimDueJobsOrFence(sql, "token_b", { limit: 5 });
    assert.equal(again.rows.length, 0);
    const asSuccess = await finalizeJob(sql, "job_1", "token_a", { ok: true });
    assert.equal(asSuccess, false);
    await pg.close();
  });

  it("fulfillment watchdog does not double-insert sla tickets on retry", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(TICKET_SCHEMA);
    const sql = toSql(pg);
    const first = await ensureSlaTicket(sql, {
      userId: "desk_a",
      threadId: "thr_a",
      offerId: "off_aaaaaaaaaaaaaaaa",
    });
    const second = await ensureSlaTicket(sql, {
      userId: "desk_a",
      threadId: "thr_a",
      offerId: "off_aaaaaaaaaaaaaaaa",
    });
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(second.id, first.id);
    const n = (await pg.query<{ n: number }>("select count(*)::int as n from agent_tickets")).rows[0];
    assert.equal(n.n, 1);
    await assert.rejects(
      () =>
        sql.query(
          `insert into agent_tickets (id, user_id, thread_id, offer_id, kind, body)
           values ($1,$2,$3,$4,'sla',$5)`,
          ["tix_dup", "desk_a", "thr_a", "off_aaaaaaaaaaaaaaaa", "dup"],
        ),
      /unique|duplicate/i,
    );
    await pg.close();
  });
});
