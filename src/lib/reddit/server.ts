import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { fetchInbox } from "./inbox";
import { buildHealthReport, probePublicProfile } from "./health";
import {
  clientCredentials,
  RedditOAuthError,
  revokeToken,
} from "./oauth";
import {
  ensureAccessToken,
  fetchMe,
  iconFromMe,
  RedditApiError,
} from "./client";
import { callbackPath, isPlausibleOrigin, redirectUriFromOrigin } from "./origin";
import {
  deleteAccount,
  expiresAtToDate,
  getAccount,
  getApp,
  listAccounts,
  markOnboarded,
  saveHealth,
  saveTokens,
  toPublicAccount,
  toPublicApp,
  upsertApp,
} from "./store";
import { userAgentFor } from "./types";

function cleanUsername(raw: string) {
  return raw.replace(/^u\//i, "").trim();
}

export const getBootstrap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const app = await getApp(context.userId);
    const accounts = await listAccounts(context.userId);
    const pending = accounts.find((a) => !a.onboarded_at);
    return {
      app: toPublicApp(app, app?.redirect_uri ?? callbackPath()),
      accounts: accounts.map(toPublicAccount),
      pendingAccountId: pending?.id ?? null,
    };
  });

export const saveRedditApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { clientId: string; clientSecret: string; userAgentName: string; origin: string }) => d)
  .handler(async ({ context, data }) => {
    const clientId = data.clientId.trim();
    const clientSecret = data.clientSecret.trim();
    const userAgentName = cleanUsername(data.userAgentName);
    if (!clientId || !clientSecret) {
      throw new Error("Paste both the client id and the secret from reddit.com/prefs/apps.");
    }
    if (!userAgentName) {
      throw new Error("Type the Reddit username of the account that created the app.");
    }
    if (!isPlausibleOrigin(data.origin)) {
      throw new Error("Could not read this page’s address for the redirect uri.");
    }
    const redirectUri = redirectUriFromOrigin(data.origin);
    const ua = userAgentFor(userAgentName);
    try {
      await clientCredentials({ clientId, clientSecret, userAgent: ua });
    } catch (err) {
      if (err instanceof RedditOAuthError) {
        if (err.status === 401) {
          throw new Error("Reddit rejected those credentials. Check client id and secret. Client id is the string under the app name, not the word “personal use script”.");
        }
        if (err.status === 403) {
          throw new Error("Reddit blocked this app. Do not create a second app for the same use. Request access via Reddit’s developer form if this keeps happening.");
        }
        throw new Error(`Reddit said ${err.message}`);
      }
      throw err;
    }
    await upsertApp({
      userId: context.userId,
      clientId,
      clientSecret,
      userAgentName,
      redirectUri,
    });
    return { ok: true as const, redirectUri, clientId };
  });

export const getRedirectUri = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { origin: string }) => d)
  .handler(async ({ data }) => {
    if (!isPlausibleOrigin(data.origin)) {
      throw new Error("Bad origin");
    }
    return { redirectUri: redirectUriFromOrigin(data.origin) };
  });

export const startRedditOAuth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { origin: string }) => d)
  .handler(async ({ context, data }) => {
    const app = await getApp(context.userId);
    if (!app) throw new Error("Save the Reddit app credentials first.");
    if (!isPlausibleOrigin(data.origin)) throw new Error("Bad origin");
    const redirectUri = redirectUriFromOrigin(data.origin);
    if (app.redirect_uri !== redirectUri) {
      await upsertApp({
        userId: context.userId,
        clientId: app.client_id,
        clientSecret: app.client_secret,
        userAgentName: app.user_agent_name,
        redirectUri,
      });
    }
    const { insertTicket } = await import("./store");
    const { authorizeUrl } = await import("./oauth");
    const ticket = crypto.randomUUID();
    const state = crypto.randomUUID();
    await insertTicket({
      ticket,
      userId: context.userId,
      state,
      redirectUri,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const url = authorizeUrl({
      clientId: app.client_id,
      redirectUri,
      state,
    });
    const start = `/api/reddit/oauth/start?ticket=${encodeURIComponent(ticket)}`;
    return { start, url, ticket };
  });

async function liveToken(userId: string, accountId: string) {
  const app = await getApp(userId);
  const account = await getAccount(userId, accountId);
  if (!app || !account) throw new Error("Account not found.");
  const token = await ensureAccessToken({
    clientId: app.client_id,
    clientSecret: app.client_secret,
    userAgentName: app.user_agent_name,
    refreshToken: account.refresh_token,
    accessToken: account.access_token,
    accessExpiresAt: expiresAtToDate(account.access_expires_at),
  });
  if (token.refreshed) {
    await saveTokens({
      userId,
      accountId,
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
    });
  }
  return {
    app,
    account,
    accessToken: token.accessToken,
    userAgent: userAgentFor(app.user_agent_name),
  };
}

export const runHealthCheck = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { accountId: string }) => d)
  .handler(async ({ context, data }) => {
    const live = await liveToken(context.userId, data.accountId);
    let me = null;
    let apiError: string | null = null;
    let remaining: number | null = null;
    try {
      const got = await fetchMe(live.accessToken, live.userAgent);
      me = got.me;
      remaining = got.remaining;
    } catch (err) {
      apiError =
        err instanceof RedditApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Reddit API failed.";
    }
    const publicProfile = me?.name
      ? await probePublicProfile(me.name, live.userAgent)
      : "unknown";
    const health = buildHealthReport({
      me,
      apiError,
      rateRemaining: remaining,
      publicProfile,
    });
    await saveHealth({
      userId: context.userId,
      accountId: data.accountId,
      health,
      me: me
        ? {
            iconImg: iconFromMe(me),
            hasVerifiedEmail: Boolean(me.has_verified_email),
            isGold: Boolean(me.is_gold),
            isMod: Boolean(me.is_mod),
            isSuspended: Boolean(me.is_suspended),
            linkKarma: me.link_karma ?? 0,
            commentKarma: me.comment_karma ?? 0,
            totalKarma: me.total_karma ?? 0,
          }
        : undefined,
    });
    const account = await getAccount(context.userId, data.accountId);
    return account ? toPublicAccount(account) : null;
  });

export const confirmOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { accountId: string; phrase: string }) => d)
  .handler(async ({ context, data }) => {
    const account = await getAccount(context.userId, data.accountId);
    if (!account) throw new Error("Account not found.");
    const health = account.health_json
      ? (JSON.parse(account.health_json) as { okToUse?: boolean })
      : null;
    if (!health?.okToUse) {
      throw new Error("Reddit did not give us a working session for this account. Connect again.");
    }
    if (data.phrase.trim().toUpperCase() !== "I WILL NOT POST YET") {
      throw new Error("Type I WILL NOT POST YET exactly to continue.");
    }
    await markOnboarded(context.userId, data.accountId);
    const next = await getAccount(context.userId, data.accountId);
    return next ? toPublicAccount(next) : null;
  });

export const loadInbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { accountId: string }) => d)
  .handler(async ({ context, data }) => {
    const account = await getAccount(context.userId, data.accountId);
    if (!account?.onboarded_at) {
      throw new Error("Finish the health screen for this account first.");
    }
    const live = await liveToken(context.userId, data.accountId);
    return fetchInbox({
      accessToken: live.accessToken,
      userAgent: live.userAgent,
    });
  });

export const disconnectAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { accountId: string }) => d)
  .handler(async ({ context, data }) => {
    const app = await getApp(context.userId);
    const removed = await deleteAccount(context.userId, data.accountId);
    if (removed && app) {
      try {
        await revokeToken({
          clientId: app.client_id,
          clientSecret: app.client_secret,
          userAgent: userAgentFor(app.user_agent_name),
          token: removed.refresh_token,
        });
      } catch {
        // already disconnected locally
      }
    }
    return { ok: true as const };
  });
