import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createOrReuseDraft, enqueueCommand, getJob, saveDetails, transitionJob } from "./store.ts";
import { drainOnce, drainOwnedPreview } from "./worker-core.ts";
import { FakeBrowserProvider, resetFakeProvider } from "./providers/fake.ts";
import { schema, toSql } from "./test-schema.ts";

describe("worker-core drain and allocation", () => {
  it("owner-scoped preview drain does not claim another user's command", async () => {
    resetFakeProvider();
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const owner = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "scope-a",
      body: { mode: "manual" },
    });
    const other = await createOrReuseDraft(sql, {
      userId: "user-b",
      mode: "manual",
      intent: "create",
      idempotencyKey: "scope-b",
      body: { mode: "manual" },
    });
    await enqueueCommand(sql, {
      userId: "user-a",
      jobId: owner.job.id,
      version: owner.job.version,
      kind: "cancel",
      idempotencyKey: "cancel-a",
      payload: {},
      operation: "cancelOnboarding",
    });
    await enqueueCommand(sql, {
      userId: "user-b",
      jobId: other.job.id,
      version: other.job.version,
      kind: "cancel",
      idempotencyKey: "cancel-b",
      payload: {},
      operation: "cancelOnboarding",
    });
    await drainOwnedPreview(sql, "user-a", owner.job.id);
    const mine = await sql.query<{ status: string }>(
      `select status from reddit_onboarding_commands where job_id = $1 and kind = 'cancel'`,
      [owner.job.id],
    );
    const still = await sql.query<{ status: string }>(
      `select status from reddit_onboarding_commands where job_id = $1 and kind = 'cancel'`,
      [other.job.id],
    );
    assert.notEqual(mine[0]?.status, "queued");
    assert.equal(still[0]?.status, "queued");
    await pg.close();
  });

  it("persists an allocation intent and never classifies TEST signup fixture", async () => {
    resetFakeProvider();
    process.env.REDDIT_ONBOARDING_ENABLED = "true";
    process.env.REDDIT_ASSISTED_SIGNUP_ENABLED = "true";
    process.env.REDDIT_ONBOARDING_FIXTURE = "true";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "assisted",
      intent: "create",
      idempotencyKey: "alloc-1",
      body: { mode: "assisted" },
    });
    const detailed = await saveDetails(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: created.job.version,
      expectedUsername: "alice_test",
      retainContext: false,
      retainPassword: false,
      assistanceConsent: true,
    });
    const started = await transitionJob(sql, {
      userId: "user-a",
      jobId: created.job.id,
      expectedVersion: detailed.version,
      event: { type: "OWNER_STARTS" },
      eventType: "started",
    });
    await enqueueCommand(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: started.version,
      kind: "start",
      idempotencyKey: "start-alloc",
      payload: {},
      operation: "startOnboarding",
    });
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./worker-core.ts", import.meta.url), "utf8"),
    );
    assert.equal(source.includes("TEST signup fixture"), false);
    await drainOnce(sql, "worker-alloc", new FakeBrowserProvider());
    const intents = await sql.query<{ id: string; status: string; provider_context_id: string | null }>(
      `select id, status, provider_context_id from reddit_allocation_intents where job_id = $1`,
      [created.job.id],
    );
    assert.equal(intents.length, 1);
    assert.ok(intents[0].provider_context_id);
    const job = await getJob(sql, "user-a", created.job.id);
    assert.ok(job?.allocation_intent_id);
    assert.equal(job?.provider_context_id, intents[0].provider_context_id);
    delete process.env.REDDIT_ONBOARDING_ENABLED;
    delete process.env.REDDIT_ASSISTED_SIGNUP_ENABLED;
    delete process.env.REDDIT_ONBOARDING_FIXTURE;
    await pg.close();
  });
});
