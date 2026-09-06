import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { completeFixtureConnect, finishIsolatedFixtureSignup, fixtureHealthReport, generateFixtureUsername } from "./fixture-connect.ts";
import { createOrReuseDraft, enqueueCommand, getJob, saveDetails, transitionJob } from "./store.ts";
import { schema, toSql } from "./test-schema.ts";
import { drainOwnedPreview } from "./worker-core.ts";
import { USERNAME_RE } from "./schemas.ts";

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

  it("generates a valid username", () => {
    const name = generateFixtureUsername();
    assert.match(name, USERNAME_RE);
    assert.notEqual(name, generateFixtureUsername());
  });

  it("one-click fixture path completes an onboarded account without owner checkboxes", async () => {
    process.env.REDDIT_ONBOARDING_FIXTURE = "true";
    process.env.REDDIT_ASSISTED_SIGNUP_ENABLED = "true";
    process.env.REDDIT_BROWSER_PROVIDER = "fake";
    delete process.env.VERCEL;
    process.env.NODE_ENV = "test";
    process.env.SECRETS_ENCRYPTION_KEY = "fixture-auto-test-key";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const username = generateFixtureUsername();
    const created = await createOrReuseDraft(sql, {
      userId: "user-auto",
      mode: "assisted",
      intent: "create",
      expectedUsername: username,
      idempotencyKey: "fx-auto",
      body: { mode: "assisted", intent: "create" },
    });
    const saved = await saveDetails(sql, {
      userId: "user-auto",
      jobId: created.job.id,
      version: created.job.version,
      expectedUsername: username,
      retainContext: false,
      retainPassword: false,
      assistanceConsent: true,
    });
    const { job: queued } = await enqueueCommand(sql, {
      userId: "user-auto",
      jobId: saved.id,
      version: saved.version,
      kind: "start",
      idempotencyKey: "fx-auto-start",
      payload: { consentVersion: "assisted-v1" },
      operation: "startOnboarding",
    });
    await transitionJob(sql, {
      userId: "user-auto",
      jobId: saved.id,
      expectedVersion: Number(queued.version),
      event: { type: "OWNER_STARTS" },
      eventType: "started",
    });
    await drainOwnedPreview(sql, "user-auto", saved.id);
    const afterDrain = await getJob(sql, "user-auto", saved.id);
    assert.equal(afterDrain?.status, "needs_user");
    assert.match(afterDrain?.wait_reason || "", /security check/i);
    const done = await finishIsolatedFixtureSignup(sql, {
      userId: "user-auto",
      jobId: saved.id,
      version: Number(afterDrain?.version ?? queued.version),
      username,
    });
    assert.equal(done.name, username);
    const job = await getJob(sql, "user-auto", saved.id);
    assert.equal(job?.status, "completed");
    assert.equal(job?.step, "finish");
    const accounts = await sql.query<{ onboarded_at: string | Date | null; name: string }>(
      "select onboarded_at, name from reddit_accounts where user_id = $1",
      ["user-auto"],
    );
    assert.equal(accounts[0]?.name, username);
    assert.ok(accounts[0]?.onboarded_at);
    delete process.env.REDDIT_ONBOARDING_FIXTURE;
    delete process.env.REDDIT_ASSISTED_SIGNUP_ENABLED;
    delete process.env.REDDIT_BROWSER_PROVIDER;
    await pg.close();
  });
});
