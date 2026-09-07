import { getSql } from "@/lib/db";
import { redditConnectorEnabled } from "@/lib/flags";
import {
  createOrReuseDraft,
  enqueueCommand,
  getJob,
  getActiveJob,
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
  steelConfigured,
} from "./config.ts";
import { ASSISTANCE_CONSENT_VERSION, ACCOUNT_CAP, CREATE_BATCH_MAX, OnboardingError, REVIEWED_SIGNUP_URL } from "./types.ts";
import { drainOwnedPreview, selectProvider } from "./worker-core.ts";
import { isPlausibleOrigin, redirectUriFromOrigin } from "../origin.ts";
import { getApp, insertTicket, purgeExpiredTickets, toPublicApp, countAccounts, listAccounts, cancelTicketsForJob, getAccount, upsertApp } from "../store.ts";
import { authorizeUrl } from "../oauth.ts";
import { appIdForDesk } from "../naming.ts";
import type { SqlLike } from "./sql.ts";
import { runOnboardingTx } from "./sql.ts";
import { finishIsolatedFixtureSignup, generateFixtureUsername, FIXTURE_APP_CLIENT_ID, FIXTURE_APP_SECRET } from "./fixture-connect.ts";
import { ownerKicksAlreadyDone } from "./owner-gates.ts";
import {
  loadAccountActions,
  bindRecoveryEmail,
  removeRecoveryEmail,
  draftAPost,
  closeBrowser,
  deleteRetainedSignIn,
  confirmDeleteRetainedSignIn,
} from "./account-actions.ts";
import {
  disconnectSteelHost,
  emptySteelHost,
  hydrateSteelFromStore,
  loadPersistedSteelKey,
  publicSteelHost,
  saveSteelHost,
} from "./browser-host.ts";
import {
  cancelOpenBatch,
  countLiveAccounts,
  createWaitCopy,
  getBatch,
  getOpenBatch,
  hostedBrowserReady,
  markBatchRunning,
  queueCreateBatch,
  recordBatchJobFinished,
  recoverOpenBatch,
  remainingCreateSlots,
  toPublicBatch,
} from "./batch.ts";
import { persistStreamedProfileAfterCreate, startStreamedCreateJob, streamedCreateReady } from "./stream-create.ts";
import { bindProfileToAccount } from "./retention.ts";
import { steelProvider } from "./providers/steel.ts";

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

async function startQueuedCreateJob(
  db: SqlLike,
  opts: { userId: string; jobId: string; idempotencyKey: string },
) {
  let job = await requireJob(db, opts.userId, opts.jobId);
  if (job.status === "draft") {
    job = await saveDetails(db, {
      userId: opts.userId,
      jobId: job.id,
      version: Number(job.version),
      expectedUsername: job.expected_username ?? undefined,
      retainContext: false,
      retainPassword: false,
      assistanceConsent: true,
    });
    const { job: queued } = await enqueueCommand(db, {
      userId: opts.userId,
      jobId: job.id,
      version: Number(job.version),
      kind: "start",
      idempotencyKey: `${opts.idempotencyKey}:start`,
      payload: { consentVersion: ASSISTANCE_CONSENT_VERSION },
      operation: "startOnboarding",
    });
    job = await transitionJob(db, {
      userId: opts.userId,
      jobId: job.id,
      expectedVersion: Number(queued.version),
      event: { type: "OWNER_STARTS" },
      eventType: "started",
      patch: { reserved_browser_seconds: sessionBudgetSeconds() },
    });
    await drainOwnedPreview(db, opts.userId, job.id);
    job = (await getJob(db, opts.userId, job.id)) || job;
  }
  return job;
}

async function startQueuedCreateManualJob(
  db: SqlLike,
  opts: { userId: string; jobId: string },
) {
  const job = await requireJob(db, opts.userId, opts.jobId);
  if (job.status !== "draft") return job;
  const size = Number(job.batch_size ?? 1);
  const index = Number(job.batch_index ?? 1);
  return handoffToManual(db, {
    userId: opts.userId,
    jobId: job.id,
    version: Number(job.version),
    waitReason: createWaitCopy(index, size, false),
  });
}

async function ensureQueuedCreateJobLive(
  db: SqlLike,
  opts: { userId: string; jobId: string; idempotencyKey: string },
) {
  const job = await requireJob(db, opts.userId, opts.jobId);
  if (job.status !== "draft" || !job.batch_id) return job;
  await hydrateSteelFromStore(db, opts.userId).catch(() => false);
  if (streamedCreateReady()) {
    try {
      return await startStreamedCreateJob(db, { userId: opts.userId, jobId: opts.jobId });
    } catch (err) {
      if (err instanceof OnboardingError && err.code === "PROVIDER_NOT_CONFIGURED") {
        return startQueuedCreateManualJob(db, { userId: opts.userId, jobId: opts.jobId });
      }
      throw err;
    }
  }
  if (hostedBrowserReady()) {
    return startQueuedCreateJob(db, opts);
  }
  return startQueuedCreateManualJob(db, { userId: opts.userId, jobId: opts.jobId });
}

export async function handleGetOnboardingBootstrap({ context }: { context: { userId: string } }) {
    const db = await sql();
    loadPersistedSteelKey();
    await hydrateSteelFromStore(db, context.userId).catch(() => false);
    let app = await getApp(context.userId);
    if (!app && onboardingFixtureEnabled()) {
      await seedFixtureApp(context.userId, "http://127.0.0.1:8080/api/reddit/oauth/callback");
      app = await getApp(context.userId);
    }
    const caps = capabilities({
      appConfigured: Boolean(app),
      connectorEnabled: redditConnectorEnabled(),
    });
    if (redditOnboardingEnabled()) {
      await recoverOpenBatch(db, context.userId).catch(() => null);
    }
    const jobRow = redditOnboardingEnabled() ? await getActiveJob(db, context.userId) : null;
    let liveJob = jobRow;
    if (liveJob?.status === "draft" && liveJob.batch_id) {
      try {
        liveJob = await ensureQueuedCreateJobLive(db, {
          userId: context.userId,
          jobId: liveJob.id,
          idempotencyKey: `resume-create:${liveJob.id}`,
        });
      } catch {
        liveJob = (await getJob(db, context.userId, liveJob.id)) || liveJob;
      }
    }
    const batch = redditOnboardingEnabled() ? await getOpenBatch(db, context.userId) : null;
    const resume = redditOnboardingEnabled() ? await listResumeCandidates(db, context.userId) : [];
    const previewUsesLocal = redditBrowserProvider() === "local" || onboardingFixtureEnabled();
    const steelHost = await publicSteelHost(db, context.userId, previewUsesLocal).catch(() =>
      emptySteelHost(previewUsesLocal),
    );
    const ownerKicksCompleted = onboardingFixtureEnabled()
      ? await ownerKicksAlreadyDone(db, context.userId).catch(() => false)
      : false;
    const accountCount = await countLiveAccounts(db, context.userId);
    return {
      onboardingEnabled: redditOnboardingEnabled(),
      assistedAvailable: caps.canStartAssistedSignup && redditAssistedSignupEnabled(),
      assistedUnavailableReason: assistedUnavailableReason(caps),
      currentJob: liveJob ? toPublicJob(liveJob, { appConfigured: Boolean(app) }) : null,
      currentBatch: batch ? toPublicBatch(batch) : null,
      resumeCandidates: resume,
      capabilities: caps,
      sessionMaxSeconds: sessionBudgetSeconds(),
      reviewedSignupUrl: REVIEWED_SIGNUP_URL,
      appConfigured: Boolean(app),
      fixtureEnabled: onboardingFixtureEnabled(),
      provider: redditBrowserProvider(),
      steelHost,
      ownerKicksCompleted,
      accountCount,
      accountCap: ACCOUNT_CAP,
      remainingCreateSlots: remainingCreateSlots(accountCount),
      createBatchMax: CREATE_BATCH_MAX,
    };
  }

export async function handleCreateOnboarding({ context, data }: { context: { userId: string }; data: any }) {
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
  }

export async function handleQueueRedditCreates({
  context,
  data,
}: {
  context: { userId: string };
  data: { count: number; idempotencyKey: string; correlationId: string };
}) {
  if (!redditOnboardingEnabled()) throw new Error("Reddit onboarding is not enabled.");
  try {
    const db = await sql();
    if (onboardingFixtureEnabled()) {
      await seedFixtureApp(context.userId, "http://127.0.0.1:8080/api/reddit/oauth/callback");
    }
    const queued = await runOnboardingTx((tx) =>
      queueCreateBatch(tx, {
        userId: context.userId,
        count: data.count,
        idempotencyKey: data.idempotencyKey,
      }),
    );
    let job = queued.job;
    let batch = queued.batch;
    try {
      job = await ensureQueuedCreateJobLive(db, {
        userId: context.userId,
        jobId: job.id,
        idempotencyKey: data.idempotencyKey,
      });
    } catch {
      job = (await getJob(db, context.userId, queued.job.id)) || job;
    }
    const started = job.status !== "draft";
    if (started) {
      const running = await markBatchRunning(db, context.userId, batch.id);
      if (running) batch = running;
    }
    if (onboardingFixtureEnabled()) {
      let currentId = job.id;
      let currentVersion = Number(job.version);
      let currentUsername = job.expected_username;
      for (;;) {
        const finished = await finishIsolatedFixtureSignup(db, {
          userId: context.userId,
          jobId: currentId,
          version: currentVersion,
          username: currentUsername,
        });
        job = finished.job;
        const advanced = await recordBatchJobFinished(db, {
          userId: context.userId,
          job: finished.job,
          outcome: "completed",
          idempotencyKey: `${data.idempotencyKey}:advance:${finished.job.batch_index ?? 0}`,
        });
        if (advanced.batch) batch = advanced.batch;
        if (!advanced.nextJob) break;
        const next = await startQueuedCreateJob(db, {
          userId: context.userId,
          jobId: advanced.nextJob.id,
          idempotencyKey: `${data.idempotencyKey}:${advanced.nextJob.batch_index ?? 0}`,
        });
        currentId = next.id;
        currentVersion = Number(next.version);
        currentUsername = next.expected_username;
      }
    }
    const app = await getApp(context.userId);
    const freshBatch = (await getBatch(db, context.userId, batch.id)) ?? batch;
    return {
      job: toPublicJob(job, { appConfigured: Boolean(app) }),
      batch: toPublicBatch(freshBatch),
      started,
    };
  } catch (err) {
    throwOnboarding(err);
  }
}

export async function handleSaveOnboardingDetails({ context, data }: { context: { userId: string }; data: any }) {
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
  }

export async function handleStartOnboarding({ context, data }: { context: { userId: string }; data: any }) {
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
  }

export async function handleGetOnboardingJob({ context, data }: { context: { userId: string }; data: any }) {
    try {
      const db = await sql();
      await drainOwnedPreview(db, context.userId, data.jobId);
      let job = await requireJob(db, context.userId, data.jobId);
      if (job.status === "draft" && job.batch_id) {
        try {
          job = await ensureQueuedCreateJobLive(db, {
            userId: context.userId,
            jobId: job.id,
            idempotencyKey: `resume-create:${job.id}`,
          });
        } catch {
          job = (await getJob(db, context.userId, data.jobId)) || job;
        }
      }
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  }

export async function handleGetOnboardingEvents({ context, data }: { context: { userId: string }; data: any }) {
    try {
      const db = await sql();
      const events = await listEvents(db, context.userId, data.jobId, data.afterSequence ?? 0);
      return { events, nextSequence: events.at(-1)?.sequence ?? data.afterSequence ?? 0 };
    } catch (err) {
      throwOnboarding(err);
    }
  }

export async function handleContinueManualOnboarding({ context, data }: { context: { userId: string }; data: any }) {
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
      await persistStreamedProfileAfterCreate(db, { userId: context.userId, job }).catch(() => undefined);
      const app = await getApp(context.userId);
      return toPublicJob(job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  }

export async function handleRequestOnboardingTakeover({ context, data }: { context: { userId: string }; data: any }) {
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
  }

export async function handleFinishOnboardingTakeover({ context, data }: { context: { userId: string }; data: any }) {
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
  }

export async function handleGetOnboardingControlView({ context, data }: { context: { userId: string }; data: any }) {
    const db = await sql();
    const job = await requireJob(db, context.userId, data.jobId);
    if (onboardingFixtureEnabled()) {
      return {
        available: true,
        url: "/__reddit-onboarding-fixture/index.html",
        sessionId: job.provider_session_id,
        kind: "fixture" as const,
        reason: null,
        fixture: true,
      };
    }
    await hydrateSteelFromStore(db, context.userId).catch(() => false);
    const streamed = Boolean(job.provider_session_id) && steelConfigured();
    if (job.control_owner !== "user" && !streamed) {
      throw new Error("Take control first. A live view is not issued while automation is running.");
    }
    const provider = steelConfigured() ? "steel" : redditBrowserProvider();
    if (job.provider_session_id && (provider === "steel" || provider === "browserbase" || provider === "local")) {
      try {
        const issuer = provider === "steel" ? steelProvider : selectProvider();
        const view = await issuer.issueControlView(
          job.provider_session_id,
          Number(job.session_generation || 1),
        );
        return {
          available: true,
          url: view.url.startsWith("local://") ? null : view.url,
          sessionId: job.provider_session_id,
          kind: provider === "local" ? ("local" as const) : ("embed" as const),
          reason: null,
          fixture: false,
        };
      } catch {
        /* fall through to owner-browser */
      }
    }
    return {
      available: false,
      url: null,
      sessionId: null,
      kind: "none",
      reason: "Use Reddit in your own browser. Embedded typing is not assumed to work on phones.",
      fixture: false,
    };
  }

export async function handleConfirmSignupSubmission({ context, data }: { context: { userId: string }; data: any }) {
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
  }

export async function handleStartJobBoundRedditOAuth({ context, data }: { context: { userId: string }; data: any }) {
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
  }

export async function handleConfirmConnectedIdentity({ context, data }: { context: { userId: string }; data: any }) {
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
      if (job.browser_profile_id && job.account_id) {
        await bindProfileToAccount(db, {
          userId: context.userId,
          profileId: job.browser_profile_id,
          accountId: job.account_id,
          redditId: job.verified_reddit_id,
          username: job.verified_username || account.name,
        }).catch(() => undefined);
        if (job.provider_session_id) {
          await steelProvider.requestRelease(job.provider_session_id).catch(() => undefined);
        }
        await persistStreamedProfileAfterCreate(db, { userId: context.userId, job }).catch(() => undefined);
      }
      const next = await transitionJob(db, {
        userId: context.userId,
        jobId: job.id,
        expectedVersion: data.version,
        event: { type: "HEALTH_USABLE_OWNER_CONFIRMS" },
        eventType: "connection_finalized",
      });
      const advanced = await recordBatchJobFinished(db, {
        userId: context.userId,
        job: next,
        outcome: "completed",
        idempotencyKey: `batch-advance:${next.id}`,
      });
      if (advanced.nextJob) {
        await ensureQueuedCreateJobLive(db, {
          userId: context.userId,
          jobId: advanced.nextJob.id,
          idempotencyKey: `batch-start:${advanced.nextJob.id}`,
        });
        if (advanced.batch) await markBatchRunning(db, context.userId, advanced.batch.id);
      }
      const app = await getApp(context.userId);
      const latest = advanced.nextJob
        ? (await getJob(db, context.userId, advanced.nextJob.id)) || advanced.nextJob
        : next;
      return {
        job: toPublicJob(next, { appConfigured: Boolean(app) }),
        nextJob: advanced.nextJob ? toPublicJob(latest, { appConfigured: Boolean(app) }) : null,
        batch: advanced.batch ? toPublicBatch(advanced.batch) : null,
      };
    } catch (err) {
      throwOnboarding(err);
    }
  }

export async function handleCancelOnboarding({ context, data }: { context: { userId: string }; data: any }) {
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
        await cancelOpenBatch(tx, context.userId, cancelled);
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
  }

export async function handleHandoffOnboardingToManual({ context, data }: { context: { userId: string }; data: any }) {
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
  }

export { toPublicApp, appIdForDesk };

export async function handleCompleteFixtureOnboarding({ context, data }: { context: { userId: string }; data: any }) {
    try {
      const { job } = await runOnboardingTx((tx) =>
        finishIsolatedFixtureSignup(tx, {
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
  }

async function runIsolatedStart(
  userId: string,
  data: { mode: "assisted" | "manual"; intent: "create" | "connect_existing"; idempotencyKey: string },
) {
  const db = await sql();
  await seedFixtureApp(userId, "http://127.0.0.1:8080/api/reddit/oauth/callback");
  const existing = await getActiveJob(db, userId);
  if (existing && existing.status !== "draft") {
    return existing;
  }
  const username = existing?.expected_username || generateFixtureUsername();
  const { job: draft } = await runOnboardingTx((tx) =>
    createOrReuseDraft(tx, {
      userId,
      mode: data.mode,
      intent: data.intent,
      expectedUsername: username,
      idempotencyKey: data.idempotencyKey,
      body: data,
    }),
  );
  let job = draft;
  if (job.status === "draft") {
    job = await saveDetails(db, {
      userId,
      jobId: job.id,
      version: Number(job.version),
      expectedUsername: username,
      retainContext: false,
      retainPassword: false,
      assistanceConsent: data.mode === "assisted",
    });
    if (job.mode === "assisted") {
      const caps = capabilities({
        assistanceConsent: true,
        approvalStatus: assistedApprovalStatus(),
      });
      if (!caps.canStartAssistedSignup) {
        throw new OnboardingError("ASSISTED_DISABLED", assistedUnavailableReason(caps) || "Guided setup is unavailable.");
      }
    }
    const { job: queued } = await enqueueCommand(db, {
      userId,
      jobId: job.id,
      version: Number(job.version),
      kind: "start",
      idempotencyKey: `${data.idempotencyKey}:start`,
      payload: { consentVersion: ASSISTANCE_CONSENT_VERSION },
      operation: "startOnboarding",
    });
    job = await transitionJob(db, {
      userId,
      jobId: job.id,
      expectedVersion: Number(queued.version),
      event: { type: "OWNER_STARTS" },
      eventType: "started",
      patch: { reserved_browser_seconds: job.mode === "assisted" ? sessionBudgetSeconds() : 0 },
    });
    await drainOwnedPreview(db, userId, job.id);
    job = (await getJob(db, userId, job.id)) || job;
  }
  return job;
}

export async function handleStartIsolatedOnboarding({ context, data }: { context: { userId: string }; data: any }) {
    if (!redditOnboardingEnabled()) throw new Error("Reddit onboarding is not enabled.");
    if (!onboardingFixtureEnabled()) {
      throw new OnboardingError("FIXTURE_DISABLED", "Isolated setup is only for this practice preview.");
    }
    try {
      const job = await runIsolatedStart(context.userId, data);
      const db = await sql();
      const skipKicks =
        job.intent === "create" &&
        job.status !== "completed" &&
        (await ownerKicksAlreadyDone(db, context.userId));
      const next = skipKicks
        ? (
            await finishIsolatedFixtureSignup(db, {
              userId: context.userId,
              jobId: job.id,
              version: Number(job.version),
              username: job.expected_username,
            })
          ).job
        : job;
      const app = await getApp(context.userId);
      return toPublicJob(next, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  }

export async function handleAutoRunIsolatedOnboarding({ context, data }: { context: { userId: string }; data: any }) {
    if (!redditOnboardingEnabled()) throw new Error("Reddit onboarding is not enabled.");
    if (!onboardingFixtureEnabled()) {
      throw new OnboardingError("FIXTURE_DISABLED", "One-click setup is only for this isolated practice preview.");
    }
    try {
      const job = await runIsolatedStart(context.userId, data);
      const db = await sql();
      const finished = await finishIsolatedFixtureSignup(db, {
        userId: context.userId,
        jobId: job.id,
        version: Number(job.version),
        username: job.expected_username,
      });
      const app = await getApp(context.userId);
      return toPublicJob(finished.job, { appConfigured: Boolean(app) });
    } catch (err) {
      throwOnboarding(err);
    }
  }

export async function handleLoadRedditAccountActions({ context, data }: { context: { userId: string }; data: any }) {
    const db = await sql();
    return loadAccountActions(db, context.userId, data.accountId);
  }

export async function handleBindRedditRecoveryEmail({ context, data }: { context: { userId: string }; data: any }) {
    const db = await sql();
    return bindRecoveryEmail(db, context.userId, {
      accountId: data.accountId,
      address: data.address,
      kind: "existing_inbox",
    });
  }

export async function handleDeleteRedditRecoveryEmail({ context, data }: { context: { userId: string }; data: any }) {
    const db = await sql();
    return removeRecoveryEmail(db, context.userId, data.bindingId);
  }

export async function handleGenerateRedditDraft({ context, data }: { context: { userId: string }; data: any }) {
    if (!redditDraftingEnabled()) throw new Error("Drafting is turned off.");
    const db = await sql();
    return draftAPost(db, context.userId, {
      accountId: data.accountId,
      communityAllowlist: data.communityAllowlist,
      topic: data.topic,
      assertedFacts: data.assertedFacts || "",
      selectedCommunity: data.selectedCommunity,
    });
  }

export async function handleCloseRedditBrowser({ context, data }: { context: { userId: string }; data: any }) {
    const db = await sql();
    return closeBrowser(db, context.userId, data.accountId);
  }

export async function handleDeleteRedditRetainedSignIn({ context, data }: { context: { userId: string }; data: any }) {
    const db = await sql();
    await deleteRetainedSignIn(db, context.userId, data.accountId);
    return confirmDeleteRetainedSignIn(db, context.userId, data.accountId);
  }

async function requireOwnedLiveSession(userId: string, jobId: string, sessionId: string) {
  const db = await sql();
  const job = await getJob(db, userId, jobId);
  if (!job) throw new Error("Setup not found.");
  if (job.control_owner !== "user") {
    throw new Error("Take control first. The live view is not writable while automation is running.");
  }
  if (!job.provider_session_id || job.provider_session_id !== sessionId) {
    throw new Error("This live view does not belong to this setup.");
  }
  return job;
}

export async function handleCaptureOnboardingLiveFrame({ context, data }: { context: { userId: string }; data: any }) {
    await requireOwnedLiveSession(context.userId, data.jobId, data.sessionId);
    const { localProvider } = await import("./providers/local.ts");
    const frame = await localProvider.screenshot(data.sessionId);
    return {
      jpeg: frame.jpeg.toString("base64"),
      pageUrl: frame.pageUrl,
    };
  }

export async function handleSendOnboardingLiveInput({ context, data }: { context: { userId: string }; data: any }) {
    await requireOwnedLiveSession(context.userId, data.jobId, data.sessionId);
    const { localProvider } = await import("./providers/local.ts");
    await localProvider.input(data.sessionId, {
      action: data.action,
      x: data.x,
      y: data.y,
      text: data.text,
      key: data.key,
    });
    return { ok: true };
  }

export async function handleSaveOnboardingSteelHost({ context, data }: { context: { userId: string }; data: any }) {
    try {
      const db = await sql();
      const saved = await saveSteelHost(db, context.userId, data.apiKey);
      return {
        ...saved,
        previewUsesLocal: redditBrowserProvider() === "local" || onboardingFixtureEnabled(),
      };
    } catch (err) {
      throwOnboarding(err);
    }
  }

export async function handleDisconnectOnboardingSteelHost({ context }: { context: { userId: string } }) {
    const db = await sql();
    const next = await disconnectSteelHost(db, context.userId);
    return {
      ...next,
      previewUsesLocal: redditBrowserProvider() === "local" || onboardingFixtureEnabled(),
    };
  }


