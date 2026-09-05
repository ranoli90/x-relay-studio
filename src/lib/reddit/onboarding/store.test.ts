import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createOrReuseDraft, enqueueCommand, getActiveJob, requireJob } from "./store.ts";
import { applyEvent } from "./machine.ts";
import { FakeBrowserProvider, resetFakeProvider } from "./providers/fake.ts";
import { drainOnce } from "./worker-core.ts";
import { DEFAULT_SESSION_POLICY } from "./provider.ts";
import { classifyPage, plannedSteps, validatePlannedAction } from "./workflows/email-signup.ts";
import { OnboardingError } from "./types.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

async function schema(pg: PGlite) {
  const sql027 = readFileSync(new URL("../../../../migrations/0027_reddit_onboarding.sql", import.meta.url), "utf8");
  const sql028 = readFileSync(new URL("../../../../migrations/0028_reddit_onboarding_backfill.sql", import.meta.url), "utf8");
  await pg.exec(`
    create table reddit_apps (
      user_id text primary key,
      client_id text not null,
      client_secret text not null,
      user_agent_name text not null,
      redirect_uri text not null
    );
    create table reddit_accounts (
      id text primary key,
      user_id text not null,
      reddit_id text not null,
      name text not null,
      onboarded_at timestamptz,
      created_at timestamptz not null default now(),
      unique (user_id, reddit_id)
    );
    create table reddit_oauth_tickets (
      ticket text primary key,
      user_id text not null,
      state text not null,
      redirect_uri text not null,
      expires_at timestamptz not null
    );
  `);
  await pg.exec(sql027);
  await pg.exec(sql028);
}

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
