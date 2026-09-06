import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { completeFixtureConnect, fixtureHealthReport } from "./fixture-connect.ts";
import { createOrReuseDraft, getJob, transitionJob } from "./store.ts";
import { schema, toSql } from "./test-schema.ts";

describe("isolated fixture connect", () => {
  it("builds a usable health report that still locks posting", () => {
    const health = fixtureHealthReport("alice");
    assert.equal(health.okToUse, true);
    assert.equal(health.postingLocked, true);
  });

  it("refuses when the fixture flag is off", async () => {
    delete process.env.REDDIT_ONBOARDING_FIXTURE;
    delete process.env.VERCEL;
    process.env.NODE_ENV = "test";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "connect_existing",
      idempotencyKey: "fx-off",
      body: { mode: "manual" },
    });
    await assert.rejects(
      () =>
        completeFixtureConnect(sql, {
          userId: "user-a",
          jobId: created.job.id,
          version: created.job.version,
          username: "alice",
        }),
      /fixture/i,
    );
    await pg.close();
  });

  it("attaches a local identity without calling Reddit when the fixture is on", async () => {
    process.env.REDDIT_ONBOARDING_FIXTURE = "true";
    delete process.env.VERCEL;
    process.env.NODE_ENV = "test";
    process.env.SECRETS_ENCRYPTION_KEY = "fixture-connect-test-key";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "connect_existing",
      expectedUsername: "alice_fx",
      idempotencyKey: "fx-on",
      body: { mode: "manual" },
    });
    const started = await transitionJob(sql, {
      userId: "user-a",
      jobId: created.job.id,
      expectedVersion: created.job.version,
      event: { type: "OWNER_STARTS" },
      eventType: "started",
    });
    const done = await completeFixtureConnect(sql, {
      userId: "user-a",
      jobId: created.job.id,
      version: started.version,
    });
    assert.equal(done.name, "alice_fx");
    const job = await getJob(sql, "user-a", created.job.id);
    assert.equal(job?.step, "health");
    assert.equal(job?.account_id, done.accountId);
    delete process.env.REDDIT_ONBOARDING_FIXTURE;
    await pg.close();
  });
});
