import { fetchMe, iconFromMe } from "./client";
import { buildHealthReport } from "./health";
import { probePublicProfile } from "./health-probe";
import { exchangeCode, revokeToken } from "./oauth";
import { userAgentFor } from "./naming";
import {
  countAccounts,
  getApp,
  getAccountByRedditId,
  redditIdTakenByOther,
  upsertAccount,
} from "./store";
import { getSql, withTransaction } from "@/lib/db";
import { ACCOUNT_CAP, OnboardingError } from "./onboarding/types";
import { normalizeUsername } from "./onboarding/schemas";
import { enqueueCleanup } from "./onboarding/store";
import { encryptV2 } from "./onboarding/vault";

export async function completeRedditOAuth(opts: {
  userId: string;
  code: string;
  redirectUri: string;
  expectedUsername?: string | null;
  expectedRedditId?: string | null;
  jobId?: string | null;
  credentialVersion?: number | null;
  allowedOrigin?: string | null;
  correlationId?: string | null;
}) {
  const app = await getApp(opts.userId);
  if (!app) throw new Error("Reddit app is not configured.");
  if (
    opts.credentialVersion != null &&
    Number(app.credential_version ?? 1) !== Number(opts.credentialVersion)
  ) {
    throw new OnboardingError(
      "CREDENTIAL_VERSION_MISMATCH",
      "Reddit app credentials changed during login. Start connect again.",
      409,
    );
  }
  const ua = userAgentFor(app.user_agent_name, app.app_id || "desk.mail");
  const tokens = await exchangeCode({
    clientId: app.client_id,
    clientSecret: app.client_secret,
    userAgent: ua,
    code: opts.code,
    redirectUri: opts.redirectUri,
  });
  if (!tokens.refresh_token) {
    throw new Error("Reddit did not return a refresh token. Duration must be permanent.");
  }

  const rejectGrant = async (reason: string) => {
    const sql = await getSql();
    const material = encryptV2(tokens.refresh_token!, {
      userId: opts.userId,
      recordId: opts.jobId || opts.userId,
      purpose: "oauth_revocation_material",
    });
    await enqueueCleanup(sql, {
      userId: opts.userId,
      jobId: opts.jobId ?? undefined,
      kind: "revoke_oauth",
      target: `rejected-grant:${opts.jobId || crypto.randomUUID()}`,
      encryptedMaterial: material,
    });
    try {
      await revokeToken({
        clientId: app.client_id,
        clientSecret: app.client_secret,
        userAgent: ua,
        token: tokens.refresh_token!,
      });
    } catch {
      /* durable cleanup retries */
    }
    return reason;
  };

  const { me, remaining } = await fetchMe(tokens.access_token, ua);
  if (!me?.id || !me.name) throw new Error("Reddit did not return an identity.");

  if (opts.expectedRedditId && opts.expectedRedditId !== me.id) {
    await rejectGrant("wrong_reddit_id");
    throw new WrongAccountError(me.name);
  }
  if (
    opts.expectedUsername &&
    normalizeUsername(opts.expectedUsername).toLowerCase() !== me.name.toLowerCase()
  ) {
    await rejectGrant("wrong_username");
    throw new WrongAccountError(me.name);
  }

  if (await redditIdTakenByOther(me.id, opts.userId)) {
    await rejectGrant("taken");
    throw new Error("That Reddit account is already connected.");
  }

  const publicProfile = await probePublicProfile(me.name, ua, tokens.access_token);
  const health = buildHealthReport({
    me,
    apiError: null,
    rateRemaining: remaining,
    publicProfile,
  });

  const canonicalId = await withTransaction(async () => {
    const sql = await getSql();
    await sql.query(`select pg_advisory_xact_lock(hashtext($1))`, [`reddit-cap:${opts.userId}`]);

    if (opts.jobId) {
      const jobs = await sql.query<{
        id: string;
        status: string;
        finished_at: string | Date | null;
        cancel_requested_at: string | Date | null;
      }>(
        `select id, status, finished_at, cancel_requested_at
           from reddit_onboarding_jobs
          where id = $1 and user_id = $2
          limit 1`,
        [opts.jobId, opts.userId],
      );
      const job = jobs[0];
      if (!job || job.finished_at || job.cancel_requested_at || job.status === "cancelled") {
        throw new OnboardingError(
          "ATTEMPT_CANCELLED",
          "This Reddit login was cancelled and cannot attach an account.",
          409,
        );
      }
    }

    if (await redditIdTakenByOther(me.id, opts.userId)) {
      throw new Error("That Reddit account is already connected.");
    }
    const existing = await getAccountByRedditId(opts.userId, me.id);
    const n = await countAccounts(opts.userId);
    if (!existing && n >= ACCOUNT_CAP) {
      throw new Error("Eight Reddit accounts is the cap on one desk. Disconnect one first.");
    }

    const stored = await upsertAccount({
      id: existing?.id ?? crypto.randomUUID(),
      userId: opts.userId,
      redditId: me.id,
      name: me.name,
      iconImg: iconFromMe(me),
      createdUtc: me.created_utc ?? null,
      hasVerifiedEmail: Boolean(me.has_verified_email),
      isGold: Boolean(me.is_gold),
      isMod: Boolean(me.is_mod),
      isSuspended: Boolean(me.is_suspended),
      linkKarma: me.link_karma ?? 0,
      commentKarma: me.comment_karma ?? 0,
      totalKarma: me.total_karma ?? (me.link_karma ?? 0) + (me.comment_karma ?? 0),
      refreshToken: tokens.refresh_token!,
      accessToken: tokens.access_token,
      accessExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope,
      health,
    });

    if (opts.jobId) {
      const linked = await sql.query(
        `update reddit_onboarding_jobs
            set verified_reddit_id = $3,
                verified_username = $4,
                identity_evidence_kind = 'oauth_verified_identity',
                identity_verified_at = now(),
                account_id = $5,
                connection_state = 'pending',
                status = 'running',
                step = 'health',
                version = version + 1,
                updated_at = now()
          where id = $1 and user_id = $2
            and finished_at is null
            and cancel_requested_at is null
            and status not in ('cancelled', 'failed', 'blocked', 'expired')
          returning id`,
        [opts.jobId, opts.userId, me.id, me.name, stored.id],
      );
      if (!linked[0]) {
        throw new OnboardingError(
          "ATTEMPT_CANCELLED",
          "This Reddit login was cancelled and cannot attach an account.",
          409,
        );
      }
    }
    return stored.id;
  }).catch(async (err) => {
    if (err instanceof OnboardingError && err.code === "ATTEMPT_CANCELLED") {
      await rejectGrant("attempt_cancelled");
    } else if (err instanceof Error && /Eight Reddit accounts is the cap/.test(err.message)) {
      await rejectGrant("cap");
    } else if (err instanceof Error && /already connected/.test(err.message)) {
      await rejectGrant("taken");
    }
    throw err;
  });

  return { accountId: canonicalId, name: me.name };
}

export class WrongAccountError extends Error {
  actualName: string;
  constructor(actualName: string) {
    super("Reddit signed in a different account than the one this setup expected.");
    this.name = "WrongAccountError";
    this.actualName = actualName;
  }
}
