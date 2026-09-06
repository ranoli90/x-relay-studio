import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  claimCommand,
  completeCommand,
  createOrReuseDraft,
  enqueueCommand,
  enqueueCleanup,
  getJob,
  renewLease,
  transitionJob,
} from "./store.ts";
import { claimCleanup } from "./cleanup.ts";
import { OnboardingError } from "./types.ts";
import { schema, toSql } from "./test-schema.ts";

async function boot() {
  const pg = new PGlite();
  await pg.waitReady;
  await schema(pg);
  return { pg, sql: toSql(pg) };
}

async function queuedJob(
  sql: ReturnType<typeof toSql>,
  opts: { userId: string; key: string; mode?: "assisted" | "manual" },
) {
  return createOrReuseDraft(sql, {
    userId: opts.userId,
    mode: opts.mode ?? "assisted",
    intent: "create",
    idempotencyKey: opts.key,
    body: { key: opts.key, mode: opts.mode ?? "assisted" },
  });
}

describe("exclusive per-job lease (RC-004)", () => {
  it("lets only one worker own a job even when two commands are queued", async () => {
    const { pg, sql } = await boot();
    const created = await queuedJob(sql, { userId: "user-a", key: "lease-two-cmds" });
    await enqueueCommand(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: created.job.version,
      kind: "cancel",
      idempotencyKey: "cmd-1",
      payload: { n: 1 },
      operation: "cancelOnboarding",
    });
    await enqueueCommand(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: created.job.version,
      kind: "start",
      idempotencyKey: "cmd-2",
      payload: { n: 2 },
      operation: "startOnboarding",
    });

    const first = await claimCommand(sql, "worker-a", 60);
    assert.ok(first);
    assert.equal(first.job.id, created.job.id);
    assert.equal(first.job.lease_owner, "worker-a");

    const rival = await claimCommand(sql, "worker-b", 60);
    assert.equal(rival, null);

    const sameOwner = await claimCommand(sql, "worker-a", 60);
    assert.ok(sameOwner);
    assert.equal(sameOwner.job.lease_owner, "worker-a");
    assert.notEqual(sameOwner.command.id, first.command.id);

    const job = await getJob(sql, "user-a", created.job.id);
    assert.equal(job?.lease_owner, "worker-a");
    await pg.close();
  });
});

describe("lease-generation fencing (RC-005)", () => {
  it("rejects a late old owner after an expired lease is taken over", async () => {
    const { pg, sql } = await boot();
    const created = await queuedJob(sql, { userId: "user-a", key: "stale-lease" });
    await enqueueCommand(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: created.job.version,
      kind: "cancel",
      idempotencyKey: "stale-cancel",
      payload: {},
      operation: "cancelOnboarding",
    });
    const old = await claimCommand(sql, "worker-old", 60);
    assert.ok(old);
    const oldGeneration = Number(old.job.lease_generation);
    const oldVersion = Number(old.job.version);

    await sql.query(
      `update reddit_onboarding_jobs set lease_until = now() - interval '10 seconds' where id = $1`,
      [created.job.id],
    );
    await sql.query(
      `update reddit_onboarding_commands
          set lease_until = now() - interval '10 seconds'
        where job_id = $1`,
      [created.job.id],
    );

    const next = await claimCommand(sql, "worker-new", 60);
    assert.ok(next);
    assert.equal(next.job.lease_owner, "worker-new");
    assert.notEqual(Number(next.job.lease_generation), oldGeneration);

    await assert.rejects(
      () =>
        transitionJob(sql, {
          userId: "user-a",
          jobId: created.job.id,
          expectedVersion: oldVersion,
          leaseOwner: "worker-old",
          leaseGeneration: oldGeneration,
          event: { type: "OWNER_STARTS" },
          eventType: "started",
        }),
      (err: unknown) => {
        assert.ok(err instanceof OnboardingError);
        assert.equal(err.code, "STALE_LEASE");
        return true;
      },
    );

    const job = await getJob(sql, "user-a", created.job.id);
    assert.equal(job?.lease_owner, "worker-new");
    assert.equal(job?.status, "draft");
    await pg.close();
  });
});

describe("lease renewal (RC-006)", () => {
  it("renews for the current owner and throws after expiry so the caller must stop", async () => {
    const { pg, sql } = await boot();
    const created = await queuedJob(sql, { userId: "user-a", key: "renew" });
    await enqueueCommand(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: created.job.version,
      kind: "cancel",
      idempotencyKey: "renew-cancel",
      payload: {},
      operation: "cancelOnboarding",
    });
    const claimed = await claimCommand(sql, "worker-a", 60);
    assert.ok(claimed);
    const generation = Number(claimed.job.lease_generation);

    const renewed = await renewLease(sql, {
      userId: "user-a",
      jobId: created.job.id,
      workerId: "worker-a",
      generation,
      leaseSeconds: 60,
    });
    assert.equal(renewed.lease_owner, "worker-a");
    assert.equal(Number(renewed.lease_generation), generation);

    await completeCommand(sql, claimed.command.id, "worker-a", Number(claimed.command.lease_generation));
    const completed = await sql.query<{ status: string }>(
      `select status from reddit_onboarding_commands where id = $1`,
      [claimed.command.id],
    );
    assert.equal(completed[0]?.status, "completed");

    await sql.query(
      `update reddit_onboarding_jobs set lease_until = now() - interval '10 seconds' where id = $1`,
      [created.job.id],
    );
    await assert.rejects(
      () =>
        renewLease(sql, {
          userId: "user-a",
          jobId: created.job.id,
          workerId: "worker-a",
          generation,
          leaseSeconds: 60,
        }),
      (err: unknown) => {
        assert.ok(err instanceof OnboardingError);
        assert.equal(err.code, "STALE_LEASE");
        return true;
      },
    );
    await pg.close();
  });
});

describe("cleanup competing claim (RC-007)", () => {
  it("does not lease the same cleanup task to two workers", async () => {
    const { pg, sql } = await boot();
    await enqueueCleanup(sql, {
      userId: "user-a",
      kind: "release_session",
      target: "ses-compete",
    });
    const first = await claimCleanup(sql, "cleaner-a");
    const second = await claimCleanup(sql, "cleaner-b");
    assert.ok(first);
    assert.equal(second, null);
    const rows = await sql.query<{ id: string; lease_owner: string | null; status: string }>(
      `select id, lease_owner, status from reddit_cleanup_tasks where target_reference = $1`,
      ["ses-compete"],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.lease_owner, "cleaner-a");
    assert.equal(rows[0]?.status, "leased");
    assert.equal(rows[0]?.id, first.id);
    await pg.close();
  });
});

describe("owner-scoped claim (RC-008)", () => {
  it("does not claim another user's command", async () => {
    const { pg, sql } = await boot();
    const alice = await queuedJob(sql, { userId: "alice", key: "alice-job" });
    const bob = await queuedJob(sql, { userId: "bob", key: "bob-job" });
    await enqueueCommand(sql, {
      userId: "alice",
      jobId: alice.job.id,
      version: alice.job.version,
      kind: "cancel",
      idempotencyKey: "alice-cancel",
      payload: {},
      operation: "cancelOnboarding",
    });
    await enqueueCommand(sql, {
      userId: "bob",
      jobId: bob.job.id,
      version: bob.job.version,
      kind: "cancel",
      idempotencyKey: "bob-cancel",
      payload: {},
      operation: "cancelOnboarding",
    });

    const scoped = await claimCommand(sql, "worker-preview", 60, {
      userId: "alice",
      jobId: alice.job.id,
    });
    assert.ok(scoped);
    assert.equal(scoped.command.user_id, "alice");
    assert.equal(scoped.command.job_id, alice.job.id);

    const wrongJob = await claimCommand(sql, "worker-other", 60, {
      userId: "alice",
      jobId: bob.job.id,
    });
    assert.equal(wrongJob, null);

    const wrongUser = await claimCommand(sql, "worker-other", 60, {
      userId: "bob",
      jobId: alice.job.id,
    });
    assert.equal(wrongUser, null);

    const bobClaim = await claimCommand(sql, "worker-other", 60, {
      userId: "bob",
      jobId: bob.job.id,
    });
    assert.ok(bobClaim);
    assert.equal(bobClaim.command.user_id, "bob");
    await pg.close();
  });
});
