import { buildHealthReport } from "../health.ts";
import { ACCOUNT_CAP, OnboardingError } from "./types.ts";
import { normalizeUsername } from "./schemas.ts";
import { onboardingFixtureEnabled } from "./config.ts";
import type { SqlLike } from "./sql.ts";
import { transitionJob, requireJob } from "./store.ts";
import type { HealthReport } from "../types.ts";
import { encryptSecret } from "../../secrets.ts";

export const FIXTURE_APP_CLIENT_ID = "fixture-preview-client";
export const FIXTURE_APP_SECRET = "fixture-preview-secret";

export function fixtureHealthReport(username: string, now = Date.now()): HealthReport {
  return buildHealthReport({
    me: {
      name: username,
      created_utc: now / 1000 - 86400 * 30,
      link_karma: 1,
      comment_karma: 12,
      total_karma: 13,
      has_verified_email: true,
      is_suspended: false,
    },
    apiError: null,
    rateRemaining: 100,
    publicProfile: "visible",
    now,
  });
}

export async function completeFixtureConnect(
  sql: SqlLike,
  opts: {
    userId: string;
    jobId: string;
    version: number;
    username?: string | null;
  },
) {
  if (!onboardingFixtureEnabled()) {
    throw new OnboardingError("FIXTURE_DISABLED", "Isolated fixture connect is off.");
  }
  const job = await requireJob(sql, opts.userId, opts.jobId, opts.version);
  const raw = (opts.username || job.expected_username || "").replace(/^u\//i, "");
  const username = normalizeUsername(raw);
  if (username.length < 3) {
    throw new OnboardingError("USERNAME_REQUIRED", "Enter the username you used. We will not guess.");
  }
  const redditId = `fixture:${opts.userId}:${username.toLowerCase()}`;
  const existing = await sql.query<{ id: string }>(
    `select id from reddit_accounts where user_id = $1 and reddit_id = $2 limit 1`,
    [opts.userId, redditId],
  );
  if (!existing[0]) {
    const counted = await sql.query<{ n: number }>(
      `select count(*)::int as n from reddit_accounts
        where user_id = $1 and disabled_at is null`,
      [opts.userId],
    );
    if (Number(counted[0]?.n ?? 0) >= ACCOUNT_CAP) {
      throw new Error("Eight Reddit accounts is the cap on one desk. Disconnect one first.");
    }
  }
  const health = fixtureHealthReport(username);
  const accountId = existing[0]?.id ?? crypto.randomUUID();
  const sealedRefresh = encryptSecret(`fixture-refresh:${opts.userId}:${username}`);
  const sealedAccess = encryptSecret(`fixture-access:${opts.userId}:${username}`);
  const rows = await sql.query<{ id: string }>(
    `insert into reddit_accounts (
       id, user_id, reddit_id, name, has_verified_email, is_suspended,
       link_karma, comment_karma, total_karma, refresh_token, access_token,
       access_expires_at, scopes, health_json, health_ok, updated_at
     ) values (
       $1,$2,$3,$4,true,false,1,12,13,$5,$6, now() + interval '1 hour',
       'identity read privatemessages', $7, true, now()
     )
     on conflict (user_id, reddit_id) do update set
       name = excluded.name,
       health_json = excluded.health_json,
       health_ok = excluded.health_ok,
       updated_at = now()
     returning id`,
    [accountId, opts.userId, redditId, username, sealedRefresh, sealedAccess, JSON.stringify(health)],
  );
  const storedId = rows[0]?.id ?? accountId;
  const next = await transitionJob(sql, {
    userId: opts.userId,
    jobId: job.id,
    expectedVersion: Number(job.version),
    event: { type: "OAUTH_INTENDED_IDENTITY" },
    eventType: "identity_verified",
    patch: {
      verified_reddit_id: redditId,
      verified_username: username,
      account_id: storedId,
      identity_evidence_kind: "fixture_identity",
    },
  });
  return { job: next, accountId: storedId, name: username };
}
