import { fetchMe, iconFromMe } from "./client";
import { buildHealthReport } from "./health";
import { probePublicProfile } from "./health-probe";
import { exchangeCode } from "./oauth";
import { userAgentFor } from "./naming";
import {
  countAccounts,
  getApp,
  getAccountByRedditId,
  redditIdTakenByOther,
  upsertAccount,
} from "./store";
import { getSql, withTransaction } from "@/lib/db";
import { ACCOUNT_CAP } from "./onboarding/types";
import { normalizeUsername } from "./onboarding/schemas";

export async function completeRedditOAuth(opts: {
  userId: string;
  code: string;
  redirectUri: string;
  expectedUsername?: string | null;
  expectedRedditId?: string | null;
  jobId?: string | null;
}) {
  const app = await getApp(opts.userId);
  if (!app) throw new Error("Reddit app is not configured.");
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
  const { me, remaining } = await fetchMe(tokens.access_token, ua);
  if (!me?.id || !me.name) throw new Error("Reddit did not return an identity.");

  if (opts.expectedRedditId && opts.expectedRedditId !== me.id) {
    throw new WrongAccountError(me.name);
  }
  if (opts.expectedUsername && normalizeUsername(opts.expectedUsername).toLowerCase() !== me.name.toLowerCase()) {
    throw new WrongAccountError(me.name);
  }

  if (await redditIdTakenByOther(me.id, opts.userId)) {
    throw new Error("That Reddit account is already connected.");
  }

  const publicProfile = await probePublicProfile(me.name, ua, tokens.access_token);
  const health = buildHealthReport({
    me,
    apiError: null,
    rateRemaining: remaining,
    publicProfile,
  });
  const existing = await getAccountByRedditId(opts.userId, me.id);
  const id = existing?.id ?? crypto.randomUUID();

  await withTransaction(async () => {
    const sql = await getSql();
    await sql.query(`select pg_advisory_xact_lock(hashtext($1))`, [`reddit-cap:${opts.userId}`]);
    if (await redditIdTakenByOther(me.id, opts.userId)) {
      throw new Error("That Reddit account is already connected.");
    }
    const n = await countAccounts(opts.userId);
    if (!existing && n >= ACCOUNT_CAP) {
      throw new Error("Eight Reddit accounts is the cap on one desk. Disconnect one first.");
    }
    await upsertAccount({
      id,
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
      await sql.query(
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
          where id = $1 and user_id = $2 and finished_at is null`,
        [opts.jobId, opts.userId, me.id, me.name, id],
      );
    }
  });

  return { accountId: id, name: me.name };
}

export class WrongAccountError extends Error {
  actualName: string;
  constructor(actualName: string) {
    super("Reddit signed in a different account than the one this setup expected.");
    this.name = "WrongAccountError";
    this.actualName = actualName;
  }
}
