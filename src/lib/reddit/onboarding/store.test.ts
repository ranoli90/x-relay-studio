import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  createOrReuseDraft,
  enqueueCommand,
  getActiveJob,
  getJob,
  handoffToManual,
  requireJob,
  saveDetails,
  transitionJob,
} from "./store.ts";
import { applyEvent } from "./machine.ts";
import { FakeBrowserProvider, resetFakeProvider } from "./providers/fake.ts";
import { drainOnce } from "./worker-core.ts";
import { DEFAULT_SESSION_POLICY } from "./provider.ts";
import { classifyPage, plannedSteps, validatePlannedAction } from "./workflows/email-signup.ts";
import { OnboardingError } from "./types.ts";
import { schema, toSql } from "./test-schema.ts";

describe("onboarding store + fake worker", () => {
  it("enforces one active job and idempotent starts", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const a = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "key-1",
      body: { mode: "manual", intent: "create" },
    });
    const b = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "key-1",
      body: { mode: "manual", intent: "create" },
    });
    assert.equal(a.job.id, b.job.id);
    await assert.rejects(
      () =>
        createOrReuseDraft(sql, {
          userId: "user-a",
          mode: "manual",
          intent: "create",
          idempotencyKey: "key-1",
          body: { mode: "manual", intent: "connect_existing" },
        }),
      OnboardingError,
    );
    await pg.close();
  });

  it("does not allocate a second session for the same intent", async () => {
    resetFakeProvider();
    const provider = new FakeBrowserProvider();
    const first = await provider.createSession({
      jobId: "job",
      allocationIntentId: "intent-1",
      generation: 1,
      policy: DEFAULT_SESSION_POLICY,
    });
    const second = await provider.createSession({
      jobId: "job",
      allocationIntentId: "intent-1",
      generation: 1,
      policy: DEFAULT_SESSION_POLICY,
    });
    assert.equal(first.sessionId, second.sessionId);
  });

  it("fails closed when a privacy option is unsupported", async () => {
    const provider = new FakeBrowserProvider();
    provider.failPrivacy = true;
    await assert.rejects(
      () =>
        provider.createSession({
          jobId: "job",
          allocationIntentId: "x",
          generation: 1,
          policy: DEFAULT_SESSION_POLICY,
        }),
      /privacy/i,
    );
  });

  it("rejects a prohibited observe candidate", () => {
    const steps = plannedSteps({ signupUrl: "https://www.reddit.com/register/", expectedUsername: "alice" });
    assert.equal(validatePlannedAction(steps[0].action, "create_account").ok, true);
    assert.equal(validatePlannedAction({ method: "evaluate" }, "create_account").ok, false);
    const unknown = classifyPage({ title: "unknown-variant" });
    assert.equal(unknown.errorCode, "UNSUPPORTED_PAGE_VARIANT");
  });

  it("processes a cancel command without claiming live success", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "c1",
      body: { mode: "manual" },
    });
    await enqueueCommand(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: created.job.version,
      kind: "cancel",
      idempotencyKey: "cancel-1",
      payload: {},
      operation: "cancelOnboarding",
    });
    await drainOnce(sql, "worker-1");
    const job = await getActiveJob(sql, "user-a");
    assert.ok(!job || job.status === "cancelled" || job.cancel_requested_at);
    await pg.close();
  });

  it("stale version is rejected", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "v1",
      body: {},
    });
    await assert.rejects(() => requireJob(sql, "user-a", created.job.id, 99), OnboardingError);
    await pg.close();
  });

  it("handoffToManual works while an assisted job is active and queues session cleanup", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "assisted",
      intent: "create",
      idempotencyKey: "handoff-1",
      body: { mode: "assisted" },
    });
    const started = await transitionJob(sql, {
      userId: "user-a",
      jobId: created.job.id,
      expectedVersion: created.job.version,
      event: { type: "OWNER_STARTS" },
      eventType: "started",
    });
    assert.equal(started.status, "queued");
    assert.equal(started.mode, "assisted");
    await sql.query(
      `update reddit_onboarding_jobs
          set provider_session_id = $1, provider_context_id = $2
        where id = $3 and user_id = $4`,
      ["ses-handoff", "ctx-handoff", created.job.id, "user-a"],
    );
    const handed = await handoffToManual(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: started.version,
    });
    assert.equal(handed.mode, "manual");
    assert.equal(handed.status, "waiting_external");
    assert.equal(handed.handoff_from_mode, "assisted");
    assert.match(String(handed.cleanup_summary), /cleanup pending/i);
    const active = await getActiveJob(sql, "user-a");
    assert.ok(active);
    assert.equal(active.id, created.job.id);
    assert.equal(active.mode, "manual");
    const tasks = await sql.query<{ kind: string; target_reference: string }>(
      `select kind, target_reference from reddit_cleanup_tasks where job_id = $1 order by kind`,
      [created.job.id],
    );
    assert.ok(tasks.some((t) => t.kind === "release_session" && t.target_reference === "ses-handoff"));
    assert.ok(tasks.some((t) => t.kind === "delete_context" && t.target_reference === "ctx-handoff"));
    const again = await handoffToManual(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: handed.version,
    });
    assert.equal(again.id, handed.id);
    assert.equal(again.mode, "manual");
    await pg.close();
  });

  it("enqueueCommand retry after version change returns the original command", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "retry-draft",
      body: { mode: "manual" },
    });
    const first = await enqueueCommand(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: created.job.version,
      kind: "cancel",
      idempotencyKey: "cancel-retry",
      payload: { reason: "owner" },
      operation: "cancelOnboarding",
    });
    assert.equal(first.duplicate, false);
    const saved = await saveDetails(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: created.job.version,
      retainContext: false,
      retainPassword: false,
      assistanceConsent: false,
    });
    assert.ok(Number(saved.version) > Number(created.job.version));
    const retry = await enqueueCommand(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: saved.version,
      kind: "cancel",
      idempotencyKey: "cancel-retry",
      payload: { reason: "owner" },
      operation: "cancelOnboarding",
    });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.command.id, first.command.id);
    const job = await getJob(sql, "user-a", created.job.id);
    assert.ok(job);
    assert.equal(Number(job.version), Number(saved.version));
    await assert.rejects(
      () =>
        enqueueCommand(sql, {
          userId: "user-a",
          jobId: created.job.id,
          version: saved.version,
          kind: "cancel",
          idempotencyKey: "cancel-retry",
          payload: { reason: "different" },
          operation: "cancelOnboarding",
        }),
      (err: unknown) => {
        assert.ok(err instanceof OnboardingError);
        assert.equal(err.code, "IDEMPOTENCY_CONFLICT");
        return true;
      },
    );
    await pg.close();
  });
});

describe("machine reuse", () => {
  it("connect existing skips creation", () => {
    const next = applyEvent(
      {
        status: "draft",
        step: "consent",
        version: 1,
        mode: "manual",
        intent: "connect_existing",
        creationOutcome: "not_started",
        connectionState: "not_started",
        controlOwner: "none",
        cancelRequested: false,
      },
      { type: "OWNER_STARTS" },
    );
    assert.equal(next.creationOutcome, "preexisting");
    assert.equal(next.step, "app_access");
  });
});
