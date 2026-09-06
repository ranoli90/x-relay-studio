import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { fetchInbox } from "./inbox";
import { buildHealthReport } from "./health";
import { probePublicProfile } from "./health-probe";
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
  countAccounts,
  deleteAccount,
  expiresAtToDate,
  getAccount,
  getApp,
  insertTicket,
  listAccounts,
  markOnboarded,
  purgeExpiredTickets,
  saveHealth,
  saveTokens,
  toPublicAccount,
  toPublicApp,
  upsertApp,
  disableAccount,
} from "./store";
import { z } from "zod";
import { accountIdSchema, confirmOnboardingSchema, originSchema, saveRedditAppSchema } from "./onboarding/schemas";
import { getSql, withTransaction } from "@/lib/db";
import { queueDisconnectCleanup } from "./onboarding/cleanup";
import { onboardingFixtureEnabled } from "./onboarding/config";
import { fixtureHealthReport } from "./onboarding/fixture-connect";
import { appIdForDesk, appNameForDesk, appDescriptionForDesk, apiSignupBlurb, assertSafeAppName, userAgentFor } from "./naming";

function ua(app: { user_agent_name: string; app_id: string | null }, accountName?: string) {
  return userAgentFor(accountName || app.user_agent_name, app.app_id || "desk.mail");
}

function cleanUsername(raw: string) {
  return raw.replace(/^u\//i, "").trim();
}

async function identityForUser(userId: string) {
  const sql = await getSql();
  const rows = await sql<{ desk_number: string }>`
    select desk_number from desks where user_id = ${userId} limit 1
  `;
  const deskNumber = rows[0]?.desk_number;
  if (!deskNumber) throw new Error("Open a desk before connecting Reddit.");
  const appLabel = assertSafeAppName(appNameForDesk(deskNumber));
  const appId = appIdForDesk(deskNumber);
  return {
    deskNumber,
    appLabel,
    appId,
    description: appDescriptionForDesk(deskNumber),
    signupBlurb: apiSignupBlurb(deskNumber),
  };
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
  .validator((d: unknown) => saveRedditAppSchema.parse(d))
  .handler(async ({ context, data }) => {
    if (!data.acceptedTerms) {
      throw new Error("Read the Data API terms and submit Reddit’s request form first.");
    }
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
    const id = await identityForUser(context.userId);
    const redirectUri = redirectUriFromOrigin(data.origin);
    const ua = userAgentFor(userAgentName, id.appId);
    try {
      await clientCredentials({ clientId, clientSecret, userAgent: ua });
    } catch (err) {
      if (err instanceof RedditOAuthError) {
        if (err.status === 401) {
          throw new Error("Reddit rejected those credentials. Check client id and secret. Client id is the string under the app name, not the word “personal use script”.");
        }
        if (err.status === 403) {
          throw new Error("Reddit blocked this app. Do not create a second app. Finish the Data API request at reddithelp, then wait for approval.");
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
      appLabel: id.appLabel,
      appId: id.appId,
      termsAt: new Date(),
      rotateCredentials: true,
    });
    return { ok: true as const, redirectUri, clientId, appLabel: id.appLabel };
  });

export const getSetupCopy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => originSchema.parse(d))
  .handler(async ({ context, data }) => {
    if (!isPlausibleOrigin(data.origin)) throw new Error("Bad origin");
    const id = await identityForUser(context.userId);
    return {
      ...id,
      redirectUri: redirectUriFromOrigin(data.origin),
    };
  });

export const startRedditOAuth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => originSchema.parse(d))
  .handler(async ({ context, data }) => {
    const app = await getApp(context.userId);
    if (!app) throw new Error("Save the Reddit app credentials first.");
    if (!isPlausibleOrigin(data.origin)) throw new Error("Bad origin");
    const n = await countAccounts(context.userId);
    if (n >= 8) {
      throw new Error("Eight Reddit accounts is the cap on one desk. Disconnect one first.");
    }
    const redirectUri = redirectUriFromOrigin(data.origin);
    if (app.redirect_uri !== redirectUri) {
      await upsertApp({
        userId: context.userId,
        clientId: app.client_id,
        clientSecret: app.client_secret,
        userAgentName: app.user_agent_name,
        redirectUri,
        appLabel: app.app_label || appIdForDesk("1000000000000001"),
        appId: app.app_id || "desk.mail",
      });
    }
    await purgeExpiredTickets();
    const { authorizeUrl } = await import("./oauth");
    const ticket = crypto.randomUUID();
    const state = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    await insertTicket({
      ticket,
      userId: context.userId,
      state,
      redirectUri,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      correlationId,
      purpose: "connect_account",
      allowedOrigin: data.origin,
    });
    const url = authorizeUrl({
      clientId: app.client_id,
      redirectUri,
      state,
    });
    const start = `/api/reddit/oauth/start?ticket=${encodeURIComponent(ticket)}`;
    return { start, url, ticket, correlationId };
  });

async function liveToken(userId: string, accountId: string) {
  const app = await getApp(userId);
  const account = await getAccount(userId, accountId);
  if (!app || !account) throw new Error("Account not found.");
  const token = await ensureAccessToken({
    clientId: app.client_id,
    clientSecret: app.client_secret,
    userAgentName: app.user_agent_name,
    appId: app.app_id || "desk.mail",
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
    userAgent: ua(app, account.name),
  };
}

export const runHealthCheck = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdSchema.parse(d))
  .handler(async ({ context, data }) => {
    if (onboardingFixtureEnabled()) {
      const account = await getAccount(context.userId, data.accountId);
      if (!account) throw new Error("Account not found.");
      const health = fixtureHealthReport(account.name);
      await saveHealth({
        userId: context.userId,
        accountId: data.accountId,
        health,
        me: {
          hasVerifiedEmail: true,
          isGold: false,
          isMod: false,
          isSuspended: false,
          linkKarma: account.link_karma ?? 0,
          commentKarma: account.comment_karma ?? 0,
          totalKarma: account.total_karma ?? 0,
        },
      });
      const next = await getAccount(context.userId, data.accountId);
      return next ? toPublicAccount(next) : null;
    }
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
      ? await probePublicProfile(me.name, live.userAgent, live.accessToken)
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
  .validator((d: unknown) => confirmOnboardingSchema.parse(d))
  .handler(async ({ context, data }) => {
    const account = await getAccount(context.userId, data.accountId);
    if (!account) throw new Error("Account not found.");
    if (account.disabled_at) {
      throw new Error("This connection is disabled. Reconnect the same account first.");
    }
    const health = account.health_json
      ? (JSON.parse(account.health_json) as { okToUse?: boolean })
      : null;
    if (!health?.okToUse || !account.health_ok) {
      throw new Error("Reddit did not give us a working session for this account. Connect again.");
    }
    if (
      data.phrase.trim() !== "I confirm this is my Reddit account and authorize the displayed connection." &&
      data.phrase.trim().toUpperCase() !== "I WILL NOT POST YET"
    ) {
      throw new Error("Type the confirmation sentence exactly to continue.");
    }
    await markOnboarded(context.userId, data.accountId);
    const next = await getAccount(context.userId, data.accountId);
    return next ? toPublicAccount(next) : null;
  });

export const loadInbox = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdSchema.parse(d))
  .handler(async ({ context, data }) => {
    const account = await getAccount(context.userId, data.accountId);
    if (!account?.onboarded_at) {
      throw new Error("Finish the health screen for this account first.");
    }
    if (onboardingFixtureEnabled()) {
      return {
        threads: [],
        unreadCount: 0,
        fetchedAt: new Date().toISOString(),
        truncated: false,
      };
    }
    const live = await liveToken(context.userId, data.accountId);
    return fetchInbox({
      accessToken: live.accessToken,
      userAgent: live.userAgent,
    });
  });

export const disconnectAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdSchema.parse(d))
  .handler(async ({ context, data }) => {
    const app = await getApp(context.userId);
    const removed = await withTransaction(async () => {
      const row = await disableAccount(context.userId, data.accountId);
      if (!row) return null;
      const db = await getSql();
      await queueDisconnectCleanup(db, {
        userId: context.userId,
        accountId: data.accountId,
        refreshToken: row.refresh_token,
      });
      return row;
    });
    if (removed && app) {
      try {
        await revokeToken({
          clientId: app.client_id,
          clientSecret: app.client_secret,
          userAgent: ua(app),
          token: removed.refresh_token,
        });
      } catch {
        // Local access stays disabled; cleanup retries revocation.
      }
    }
    return { ok: true as const, cleanup: "pending" as const };
  });
