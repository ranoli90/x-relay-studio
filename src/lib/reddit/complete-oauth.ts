import { fetchMe, iconFromMe } from "./client";
import { buildHealthReport, probePublicProfile } from "./health";
import { exchangeCode } from "./oauth";
import { userAgentFor } from "./types";
import {
  getApp,
  getAccountByRedditId,
  redditIdTakenByOther,
  upsertAccount,
} from "./store";

export async function completeRedditOAuth(opts: {
  userId: string;
  code: string;
  redirectUri: string;
}) {
  const app = await getApp(opts.userId);
  if (!app) throw new Error("Reddit app is not configured.");
  const ua = userAgentFor(app.user_agent_name);
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
  if (await redditIdTakenByOther(me.id, opts.userId)) {
    throw new Error("That Reddit account is already connected to another user.");
  }
  const publicProfile = await probePublicProfile(me.name, ua);
  const health = buildHealthReport({
    me,
    apiError: null,
    rateRemaining: remaining,
    publicProfile,
  });
  const existing = await getAccountByRedditId(opts.userId, me.id);
  const id = existing?.id ?? crypto.randomUUID();
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
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope,
    health,
  });
  return { accountId: id, name: me.name };
}
