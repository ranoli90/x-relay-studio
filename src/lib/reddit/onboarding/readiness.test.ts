import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  emptyReadinessReport,
  getReadiness,
  observeReadiness,
  READINESS_CHECK_KEYS,
  replacementAccountForbidden,
  shouldPauseForRestriction,
} from "./readiness.ts";

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
  const sql029 = readFileSync(new URL("../../../../migrations/0029_reddit_onboarding_lifecycle.sql", import.meta.url), "utf8");
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
  await pg.exec(sql029);
}

describe("readiness review", () => {
  it("keeps unknown checks unknown with a reason and no last observation", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const report = await getReadiness(sql, "user-a", "acct-1");
    assert.equal(report.inventedReputation, false);
    assert.equal(report.cqsClaim, null);
    assert.equal(report.checks.length, READINESS_CHECK_KEYS.length);
    for (const check of report.checks) {
      assert.equal(check.status, "unknown");
      assert.ok(check.reason);
      assert.equal(check.lastObservedAt, null);
    }
    await pg.close();
  });

  it("records only observed checks and never invents a score", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const report = await observeReadiness(sql, {
      userId: "user-a",
      accountId: "acct-1",
      observations: {
        owner: { status: "pass", reason: "Studio owner confirmed this account." },
        identity: { status: "verified", reason: "OAuth identity matched." },
      },
    });
    const owner = report.checks.find((c) => c.key === "owner");
    const identity = report.checks.find((c) => c.key === "identity");
    const access = report.checks.find((c) => c.key === "access");
    assert.equal(owner?.status, "pass");
    assert.ok(owner?.lastObservedAt);
    assert.equal(identity?.status, "verified");
    assert.equal(access?.status, "unknown");
    assert.equal(access?.lastObservedAt, null);
    assert.equal(report.inventedReputation, false);
    assert.equal(report.cqsClaim, null);
    const blob = JSON.stringify(report);
    assert.equal(/high elo|warm-?up|karma farm/i.test(blob), false);
    assert.ok(report.checks.every((c) => c.status !== "usable"));
    await pg.close();
  });

  it("pauses on restriction and does not create a replacement account", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const before = await sql.query<{ n: string }>(`select count(*)::text as n from reddit_accounts`);
    const report = await observeReadiness(sql, {
      userId: "user-a",
      accountId: "acct-1",
      observations: {
        restriction: { status: "restricted", reason: "Reddit reported a restriction." },
      },
    });
    assert.equal(shouldPauseForRestriction(report), true);
    assert.equal(replacementAccountForbidden(report), true);
    const after = await sql.query<{ n: string }>(`select count(*)::text as n from reddit_accounts`);
    assert.equal(after[0].n, before[0].n);
    const jobs = await sql.query<{ n: string }>(`select count(*)::text as n from reddit_onboarding_jobs`);
    assert.equal(Number(jobs[0].n), 0);
    await pg.close();
  });

  it("empty report is honest about missing evidence", () => {
    const report = emptyReadinessReport("acct-x");
    assert.equal(report.accountId, "acct-x");
    assert.equal(report.inventedReputation, false);
    assert.equal(report.cqsClaim, null);
    assert.ok(report.checks.every((c) => c.status === "unknown"));
  });
});
