import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { redditConnectorEnabled } from "@/lib/flags";
import {
  cancelSchema,
  confirmIdentitySchema,
  confirmSubmitSchema,
  continueManualSchema,
  createOnboardingSchema,
  eventsQuerySchema,
  jobIdQuerySchema,
  saveDetailsSchema,
  startOauthSchema,
  startOnboardingSchema,
  versionedJobSchema,
  accountIdQuerySchema,
  completeFixtureSchema,
  bindEmailSchema,
  deleteBindingSchema,
  generateDraftSchema,
} from "./schemas.ts";
import {
  createOrReuseDraft,
  enqueueCommand,
  getJob,
  listEvents,
  listResumeCandidates,
  requireJob,
  saveDetails,
  toPublicJob,
  transitionJob,
  sessionBudgetSeconds,
  enqueueCleanup,
  handoffToManual,
} from "./store.ts";
import { capabilities, assistedUnavailableReason } from "./policy.ts";
import {
  redditOnboardingEnabled,
  redditAssistedSignupEnabled,
  redditBrowserProvider,
  onboardingFixtureEnabled,
  assistedApprovalStatus,
  redditDraftingEnabled,
} from "./config.ts";
import { ASSISTANCE_CONSENT_VERSION, OnboardingError, REVIEWED_SIGNUP_URL } from "./types.ts";
import { drainOwnedPreview } from "./worker-core.ts";
import { isPlausibleOrigin, redirectUriFromOrigin } from "../origin.ts";
import { getApp, insertTicket, purgeExpiredTickets, toPublicApp, countAccounts, listAccounts, cancelTicketsForJob, getAccount, upsertApp } from "../store.ts";
import { authorizeUrl } from "../oauth.ts";
import { appIdForDesk } from "../naming.ts";
import type { SqlLike } from "./sql.ts";
import { runOnboardingTx } from "./sql.ts";
import { completeFixtureConnect, FIXTURE_APP_CLIENT_ID, FIXTURE_APP_SECRET } from "./fixture-connect.ts";
import {
  loadAccountActions,
  bindRecoveryEmail,
  removeRecoveryEmail,
  draftAPost,
  closeBrowser,
  deleteRetainedSignIn,
  confirmDeleteRetainedSignIn,
} from "./account-actions.ts";

async function sql(): Promise<SqlLike> {
  return getSql();
}

async function seedFixtureApp(userId: string, redirectUri: string) {
  if (!onboardingFixtureEnabled()) {
    throw new OnboardingError("FIXTURE_DISABLED", "Isolated fixture connect is off.");
  }
  const existing = await getApp(userId);
  if (existing) return existing;
  await upsertApp({
    userId,
    clientId: FIXTURE_APP_CLIENT_ID,
    clientSecret: FIXTURE_APP_SECRET,
    userAgentName: "x-relay-fixture",
    redirectUri,
    appLabel: "Isolated fixture app",
    appId: "desk.fixture",
    rotateCredentials: false,
  });
  return getApp(userId);
}

function throwOnboarding(err: unknown): never {
  if (err instanceof OnboardingError) {
    const error = new Error(err.message) as Error & { code?: string; status?: number; currentVersion?: number };
    error.code = err.code;
    error.status = err.httpStatus;
    error.currentVersion = err.currentVersion;
    throw error;
  }
  throw err;
}

export const getOnboardingBootstrap = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = await sql();
    let app = await getApp(context.userId);
    if (!app && onboardingFixtureEnabled()) {
      await seedFixtureApp(context.userId, "http://127.0.0.1:8080/api/reddit/oauth/callback");
      app = await getApp(context.userId);
    }
    const caps = capabilities({
      appConfigured: Boolean(app),
      connectorEnabled: redditConnectorEnabled(),
    });
    const job = redditOnboardingEnabled() ? await import("./store.ts").then((m) => m.getActiveJob(db, context.userId)) : null;
    const resume = redditOnboardingEnabled() ? await listResumeCandidates(db, context.userId) : [];
    return {
      onboardingEnabled: redditOnboardingEnabled(),
      assistedAvailable: caps.canStartAssistedSignup && redditAssistedSignupEnabled(),
      assistedUnavailableReason: assistedUnavailableReason(caps),
      currentJob: job ? toPublicJob(job, { appConfigured: Boolean(app) }) : null,
      resumeCandidates: resume,
      capabilities: caps,
      sessionMaxSeconds: sessionBudgetSeconds(),
      reviewedSignupUrl: REVIEWED_SIGNUP_URL,
      appConfigured: Boolean(app),
      fixtureEnabled: onboardingFixtureEnabled(),
      provider: redditBrowserProvider(),
    };
  });

export const createOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => createOnboardingSchema.parse(d))
  .handler(async ({ context, data }) => {
    if (!redditOnboardingEnabled()) throw new Error("Reddit onboarding is not enabled.");
    try {
      const { job } = await runOnboardingTx((db) =>
        createOrReuseDraft(db, {
          userId: context.userId,
          mode: data.mode,
          intent: data.intent,
          expectedUsername: data.expectedUsername,
          idempotencyKey: data.idempotencyKey,
          body: data,
        }),
      );
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const saveOnboardingDetails = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => saveDetailsSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const db = await sql();
      const job = await saveDetails(db, {
        userId: context.userId,
        jobId: data.jobId,
        version: data.version,
        expectedUsername: data.expectedUsername,
        retainContext: Boolean(data.retainContext),
        retainPassword: Boolean(data.retainPassword),
        assistanceConsent: Boolean(data.assistanceConsent),
      });
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const startOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => startOnboardingSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const db = await sql();
      const job = await requireJob(db, context.userId, data.jobId, data.version);
      if (job.mode === "assisted") {
        const caps = capabilities({
          assistanceConsent: data.consentVersion === ASSISTANCE_CONSENT_VERSION,
          approvalStatus: assistedApprovalStatus(),
        });
        if (!caps.canStartAssistedSignup) {
          throw new OnboardingError("ASSISTED_DISABLED", assistedUnavailableReason(caps) || "Guided setup is unavailable.");
        }
      }
      const { job: next } = await enqueueCommand(db, {
        userId: context.userId,
        jobId: data.jobId,
        version: data.version,
        kind: "start",
        idempotencyKey: data.idempotencyKey,
        payload: { consentVersion: data.consentVersion },
        operation: "startOnboarding",
      });
      const started = await transitionJob(db, {
        userId: context.userId,
        jobId: data.jobId,
        expectedVersion: Number(next.version),
        event: { type: "OWNER_STARTS" },
        eventType: "started",
        patch: { reserved_browser_seconds: job.mode === "assisted" ? sessionBudgetSeconds() : 0 },
      });
      await drainOwnedPreview(db, context.userId, data.jobId);
      const app = await getApp(context.userId);
      const fresh = (await getJob(db, context.userId, data.jobId)) || started;
      return toPublicJob(fresh, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const getOnboardingJob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => jobIdQuerySchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const db = await sql();
      await drainOwnedPreview(db, context.userId, data.jobId);
      const job = await requireJob(db, context.userId, data.jobId);
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const getOnboardingEvents = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => eventsQuerySchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const db = await sql();
      const events = await listEvents(db, context.userId, data.jobId, data.afterSequence ?? 0);
      return { events, nextSequence: events.at(-1)?.sequence ?? data.afterSequence ?? 0 };
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const continueManualOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => continueManualSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const db = await sql();
      const job = await transitionJob(db, {
        userId: context.userId,
        jobId: data.jobId,
        expectedVersion: data.version,
        event: { type: "MANUAL_OWNER_REPORTED" },
        eventType: "step_completed",
        patch: {
          expected_username: data.username,
          identity_evidence_kind: "owner_reported",
          wait_reason: data.ownerCreated
            ? "You reported creating this account. Connect it to verify."
            : "Account creation is still unconfirmed.",
        },
        details: { ownerCreated: data.ownerCreated },
      });
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const requestOnboardingTakeover = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => versionedJobSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const db = await sql();
      await enqueueCommand(db, {
        userId: context.userId,
        jobId: data.jobId,
        version: data.version,
        kind: "request_takeover",
        idempotencyKey: `takeover:${data.jobId}:${data.version}`,
        payload: {},
        operation: "requestTakeover",
      });
      await drainOwnedPreview(db, context.userId, data.jobId);
      const job = await requireJob(db, context.userId, data.jobId);
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const finishOnboardingTakeover = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => versionedJobSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const db = await sql();
      await enqueueCommand(db, {
        userId: context.userId,
        jobId: data.jobId,
        version: data.version,
        kind: "end_takeover",
        idempotencyKey: `end-takeover:${data.jobId}:${data.version}`,
        payload: {},
        operation: "finishTakeover",
      });
      await drainOwnedPreview(db, context.userId, data.jobId);
      const job = await requireJob(db, context.userId, data.jobId);
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const getOnboardingControlView = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => versionedJobSchema.parse(d))
  .handler(async ({ context, data }) => {
    const db = await sql();
    const job = await requireJob(db, context.userId, data.jobId);
    if (job.control_owner !== "user") {
      throw new Error("Take control first. A live view is not issued while automation is running.");
    }
    if (onboardingFixtureEnabled()) {
      return {
        available: true,
        url: "/__reddit-onboarding-fixture/",
        reason: null,
        fixture: true,
      };
    }
    return { available: false, reason: "Use Reddit in your own browser. Embedded typing is not assumed to work on phones." };
  });

export const confirmSignupSubmission = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => confirmSubmitSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const db = await sql();
      await enqueueCommand(db, {
        userId: context.userId,
        jobId: data.jobId,
        version: data.version,
        kind: "confirm_submit",
        idempotencyKey: data.confirmation,
        payload: { confirmationHash: data.confirmation },
        operation: "confirmSubmit",
      });
      await drainOwnedPreview(db, context.userId, data.jobId);
      const job = await requireJob(db, context.userId, data.jobId);
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const startJobBoundRedditOAuth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => startOauthSchema.parse(d))
  .handler(async ({ context, data }) => {
    if (!redditConnectorEnabled()) throw new Error("Reddit is turned off.");
    if (data.transport === "remote") throw new Error("Hosted Reddit login is disabled until its dedicated tests pass.");
    if (!isPlausibleOrigin(data.origin)) throw new Error("This page origin is not allowed for Reddit login.");
    try {
      const db = await sql();
      const job = await requireJob(db, context.userId, data.jobId, data.version);
      const app = await getApp(context.userId);
      if (!app) throw new Error("Save the Reddit app credentials first.");
      const n = await countAccounts(context.userId);
      if (n >= 8) {
        const accounts = await listAccounts(context.userId);
        const reconnect = job.expected_username
          ? accounts.some((a) => a.name.toLowerCase() === job.expected_username?.toLowerCase())
          : false;
        if (!reconnect) throw new Error("Eight Reddit accounts is the cap on one desk. Disconnect one first.");
      }
      const redirectUri = redirectUriFromOrigin(data.origin);
      await purgeExpiredTickets();
      const ticket = crypto.randomUUID();
      const state = crypto.randomUUID();
      const correlationId = data.correlationId;
      if (!correlationId) {
        throw new OnboardingError("CORRELATION_REQUIRED", "A correlation identifier is required.");
      }
      await runOnboardingTx(async (tx) => {
        await insertTicket(
          {
            ticket,
            userId: context.userId,
            state,
            redirectUri,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            jobId: job.id,
            expectedUsername: job.expected_username,
            expectedRedditId: job.verified_reddit_id,
            credentialVersion: app.credential_version ?? 1,
            correlationId,
            transport: "local",
            purpose: "connect_account",
            allowedOrigin: data.origin,
          },
          tx,
        );
        const bound = await tx.query<{ ticket: string }>(
          `select ticket from reddit_oauth_tickets
            where ticket = $1 and user_id = $2 and job_id = $3 and correlation_id = $4
            limit 1`,
          [ticket, context.userId, job.id, correlationId],
        );
        if (!bound[0]) {
          throw new OnboardingError("OAUTH_BIND_FAILED", "Could not bind this Reddit login attempt.", 500);
        }
        await transitionJob(tx, {
          userId: context.userId,
          jobId: job.id,
          expectedVersion: Number(job.version),
          event: { type: "OWNER_STARTS_OAUTH" },
          eventType: "oauth_started",
        });
      });
      const url = authorizeUrl({
        clientId: app.client_id,
        redirectUri,
        state,
      });
      const start = `/api/reddit/oauth/start?ticket=${encodeURIComponent(ticket)}`;
      return { start, url, ticket, correlationId };
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const confirmConnectedIdentity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => confirmIdentitySchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const phrase = data.confirmation.trim();
      if (!/^I confirm this is my Reddit account and authorize the displayed connection\.?$/i.test(phrase)) {
        throw new Error("Type the confirmation sentence exactly to finish.");
      }
      const db = await sql();
      const job = await requireJob(db, context.userId, data.jobId, data.version);
      if (!job.verified_reddit_id || job.connection_state === "not_started") {
        throw new Error("Connect with Reddit first. A typed message does not prove the account.");
      }
      if (!job.account_id) {
        throw new Error("No account is attached to this setup yet.");
      }
      if (job.cancel_requested_at || job.finished_at || job.status === "cancelled") {
        throw new OnboardingError("ATTEMPT_CANCELLED", "This setup was cancelled and cannot be confirmed.");
      }
      const account = await getAccount(context.userId, job.account_id);
      if (!account) {
        throw new Error("The connected Reddit account does not match this setup.");
      }
      if (account.disabled_at) {
        throw new Error("This connection is disabled. Reconnect the same account first.");
      }
      if (!account.health_ok) {
        throw new Error("Health is not clear for this connection yet.");
      }
      if (account.name.toLowerCase() !== (job.verified_username || "").toLowerCase()) {
        throw new Error("The connected Reddit account does not match this setup.");
      }
      const next = await transitionJob(db, {
        userId: context.userId,
        jobId: job.id,
        expectedVersion: data.version,
        event: { type: "HEALTH_USABLE_OWNER_CONFIRMS" },
        eventType: "connection_finalized",
      });
      const app = await getApp(context.userId);
      return toPublicJob(next, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const cancelOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => cancelSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const next = await runOnboardingTx(async (tx) => {
        const job = await requireJob(tx, context.userId, data.jobId, data.version);
        await enqueueCommand(tx, {
          userId: context.userId,
          jobId: data.jobId,
          version: data.version,
          kind: "cancel",
          idempotencyKey: data.idempotencyKey,
          payload: {},
          operation: "cancelOnboarding",
        });
        const cancelled = await transitionJob(tx, {
          userId: context.userId,
          jobId: data.jobId,
          expectedVersion: data.version,
          event: { type: "OWNER_CANCELS" },
          eventType: "cancelled",
          patch: { cleanup_summary: job.provider_session_id ? "Browser cleanup pending." : "No hosted browser to clean up." },
        });
        await cancelTicketsForJob(context.userId, data.jobId, tx);
        if (job.provider_session_id) {
          await enqueueCleanup(tx, {
            userId: context.userId,
            jobId: job.id,
            kind: "release_session",
            target: job.provider_session_id,
          });
        }
        return cancelled;
      });
      const db = await sql();
      await drainOwnedPreview(db, context.userId, data.jobId);
      const app = await getApp(context.userId);
      const fresh = (await getJob(db, context.userId, data.jobId)) || next;
      return toPublicJob(fresh, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const handoffOnboardingToManual = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => versionedJobSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const job = await runOnboardingTx((tx) =>
        handoffToManual(tx, {
          userId: context.userId,
          jobId: data.jobId,
          version: data.version,
        }),
      );
      const db = await sql();
      await drainOwnedPreview(db, context.userId, data.jobId);
      const app = await getApp(context.userId);
      const fresh = (await getJob(db, context.userId, data.jobId)) || job;
      return toPublicJob(fresh, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export { toPublicApp, appIdForDesk };

export const completeFixtureOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => completeFixtureSchema.parse(d))
  .handler(async ({ context, data }) => {
    try {
      const { job } = await runOnboardingTx((tx) =>
        completeFixtureConnect(tx, {
          userId: context.userId,
          jobId: data.jobId,
          version: data.version,
          username: data.username,
        }),
      );
      const db = await sql();
      const app = await getApp(context.userId);
      const fresh = (await getJob(db, context.userId, data.jobId)) || job;
      return toPublicJob(fresh, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  });

export const loadRedditAccountActions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdQuerySchema.parse(d))
  .handler(async ({ context, data }) => {
    const db = await sql();
    return loadAccountActions(db, context.userId, data.accountId);
  });

export const bindRedditRecoveryEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => bindEmailSchema.parse(d))
  .handler(async ({ context, data }) => {
    const db = await sql();
    return bindRecoveryEmail(db, context.userId, {
      accountId: data.accountId,
      address: data.address,
      kind: "existing_inbox",
    });
  });

export const deleteRedditRecoveryEmail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => deleteBindingSchema.parse(d))
  .handler(async ({ context, data }) => {
    const db = await sql();
    return removeRecoveryEmail(db, context.userId, data.bindingId);
  });

export const generateRedditDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => generateDraftSchema.parse(d))
  .handler(async ({ context, data }) => {
    if (!redditDraftingEnabled()) throw new Error("Drafting is turned off.");
    const db = await sql();
    return draftAPost(db, context.userId, {
      accountId: data.accountId,
      communityAllowlist: data.communityAllowlist,
      topic: data.topic,
      assertedFacts: data.assertedFacts || "",
      selectedCommunity: data.selectedCommunity,
    });
  });

export const closeRedditBrowser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdQuerySchema.parse(d))
  .handler(async ({ context, data }) => {
    const db = await sql();
    return closeBrowser(db, context.userId, data.accountId);
  });

export const deleteRedditRetainedSignIn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: unknown) => accountIdQuerySchema.parse(d))
  .handler(async ({ context, data }) => {
    const db = await sql();
    await deleteRetainedSignIn(db, context.userId, data.accountId);
    return confirmDeleteRetainedSignIn(db, context.userId, data.accountId);
  });

