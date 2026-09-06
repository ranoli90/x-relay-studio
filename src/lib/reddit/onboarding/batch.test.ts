import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OnboardingError } from "./types.ts";
import { getActiveJob, getJob, handoffToManual, toPublicJob } from "./store.ts";
import {
  cancelOpenBatch,
  createWaitCopy,
  queueCreateBatch,
  recordBatchJobFinished,
  recoverOpenBatch,
  remainingCreateSlots,
} from "./batch.ts";
import { schema, toSql } from "./test-schema.ts";

describe("reddit create batch", () => {
  it("clamps remaining slots to 1–5 under the desk cap of 8", () => {
    assert.equal(remainingCreateSlots(0), 5);
    assert.equal(remainingCreateSlots(6), 2);
    assert.equal(remainingCreateSlots(8), 0);
    assert.equal(remainingCreateSlots(9), 0);
  });

  it("queues five creates as one live job plus a batch of 5", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const queued = await queueCreateBatch(sql, {
      userId: "user-a",
      count: 5,
      idempotencyKey: "batch-5",
    });
    assert.equal(queued.batch.size, 5);
    assert.equal(queued.batch.status, "queued");
    assert.equal(queued.job.batch_id, queued.batch.id);
    assert.equal(Number(queued.job.batch_index), 1);
    assert.equal(Number(queued.job.batch_size), 5);
    assert.equal(queued.job.mode, "assisted");
    assert.equal(queued.job.intent, "create");
    const active = await getActiveJob(sql, "user-a");
    assert.equal(active?.id, queued.job.id);
    const jobs = await sql.query<{ n: number }>(
      `select count(*)::int as n from reddit_onboarding_jobs where user_id = $1`,
      ["user-a"],
    );
    assert.equal(Number(jobs[0]?.n), 1);
    await pg.close();
  });

  it("rejects a second open batch and reuses the same size", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const first = await queueCreateBatch(sql, {
      userId: "user-a",
      count: 3,
      idempotencyKey: "batch-3",
    });
    const again = await queueCreateBatch(sql, {
      userId: "user-a",
      count: 3,
      idempotencyKey: "batch-3-again",
    });
    assert.equal(again.batch.id, first.batch.id);
    await assert.rejects(
      () =>
        queueCreateBatch(sql, {
          userId: "user-a",
          count: 5,
          idempotencyKey: "batch-5",
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "ACTIVE_BATCH_EXISTS",
    );
    await pg.close();
  });

  it("spawns the next job after the current one finishes", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const queued = await queueCreateBatch(sql, {
      userId: "user-a",
      count: 5,
      idempotencyKey: "batch-advance",
    });
    await sql.query(
      `update reddit_onboarding_jobs
          set status = 'completed', finished_at = now(), version = version + 1
        where id = $1`,
      [queued.job.id],
    );
    const finished = await getJob(sql, "user-a", queued.job.id);
    assert.ok(finished);
    const advanced = await recordBatchJobFinished(sql, {
      userId: "user-a",
      job: finished,
      outcome: "completed",
    });
    assert.ok(advanced.nextJob);
    assert.equal(Number(advanced.nextJob.batch_index), 2);
    assert.equal(advanced.batch?.current_index, 2);
    assert.equal(advanced.batch?.status, "running");
    const active = await getActiveJob(sql, "user-a");
    assert.equal(active?.id, advanced.nextJob.id);
    const jobs = await sql.query<{ n: number }>(
      `select count(*)::int as n from reddit_onboarding_jobs where batch_id = $1`,
      [queued.batch.id],
    );
    assert.equal(Number(jobs[0]?.n), 2);

    let current = advanced.nextJob;
    for (let index = 2; index <= 5; index += 1) {
      assert.ok(current);
      await sql.query(
        `update reddit_onboarding_jobs
            set status = 'completed', finished_at = now(), version = version + 1
          where id = $1`,
        [current.id],
      );
      const done = await getJob(sql, "user-a", current.id);
      assert.ok(done);
      const step = await recordBatchJobFinished(sql, {
        userId: "user-a",
        job: done,
        outcome: "completed",
      });
      if (index < 5) {
        assert.ok(step.nextJob);
        assert.equal(Number(step.nextJob.batch_index), index + 1);
        current = step.nextJob;
      } else {
        assert.equal(step.nextJob, null);
        assert.equal(step.batch?.status, "completed");
        assert.equal(Number(step.batch?.completed_count), 5);
      }
    }
    await pg.close();
  });

  it("stops remaining work when the owner cancels", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const queued = await queueCreateBatch(sql, {
      userId: "user-a",
      count: 4,
      idempotencyKey: "batch-cancel",
    });
    await sql.query(
      `update reddit_onboarding_jobs
          set status = 'cancelled', finished_at = now()
        where id = $1`,
      [queued.job.id],
    );
    const finished = await getJob(sql, "user-a", queued.job.id);
    assert.ok(finished);
    const stopped = await cancelOpenBatch(sql, "user-a", finished);
    assert.equal(stopped?.status, "cancelled");
    const recovered = await recoverOpenBatch(sql, "user-a");
    assert.equal(recovered, null);
    await pg.close();
  });

  it("refuses more than five and empty counts", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    await assert.rejects(
      () => queueCreateBatch(sql, { userId: "user-a", count: 6, idempotencyKey: "too-many" }),
      OnboardingError,
    );
    await assert.rejects(
      () => queueCreateBatch(sql, { userId: "user-a", count: 0, idempotencyKey: "none" }),
      OnboardingError,
    );
    await pg.close();
  });

  it("uses honest wait copy when no hosted browser is filling the form", () => {
    assert.equal(createWaitCopy(1, 1, false), "Create this Reddit account.");
    assert.equal(createWaitCopy(2, 5, false), "Queued 5 accounts. Create 2 of 5 on Reddit.");
    assert.equal(createWaitCopy(1, 1, true), "Making this Reddit account.");
  });

  it("hands a queued draft to manual so continue-to-connect is allowed", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const queued = await queueCreateBatch(sql, {
      userId: "user-a",
      count: 1,
      idempotencyKey: "batch-manual",
    });
    assert.equal(queued.job.status, "draft");
    const handed = await handoffToManual(sql, {
      userId: "user-a",
      jobId: queued.job.id,
      version: Number(queued.job.version),
      waitReason: createWaitCopy(1, 1, false),
    });
    assert.equal(handed.mode, "manual");
    assert.equal(handed.status, "waiting_external");
    assert.equal(handed.step, "create_account");
    assert.equal(handed.wait_reason, "Create this Reddit account.");
    const pub = toPublicJob(handed, { appConfigured: false });
    assert.equal(pub.permittedActions.includes("open_signup"), true);
    assert.equal(pub.permittedActions.includes("continue_manual"), true);
    assert.equal(pub.waitReason, "Create this Reddit account.");
    await pg.close();
  });
});
