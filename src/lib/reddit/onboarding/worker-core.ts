import type { SqlLike } from "./sql.ts";
import type { BrowserProvider } from "./provider.ts";
import { DEFAULT_SESSION_POLICY } from "./provider.ts";
import {
  claimCommand,
  completeCommand,
  enqueueCleanup,
  getJob,
  insertEvent,
  renewLease,
  sessionBudgetSeconds,
  transitionJob,
  type CommandRow,
  type JobRow,
} from "./store.ts";
import { irreversibleSubmitBlocked, isTerminal } from "./machine.ts";
import { plannedSteps, validatePlannedAction } from "./workflows/email-signup.ts";
import { pinWorkflowVersion } from "./workflows/manifest.ts";
import { capabilities } from "./policy.ts";
import { BrowserProviderError } from "./provider.ts";
import { REVIEWED_SIGNUP_URL } from "./types.ts";
import { FakePageDriver, fixtureSignupUrl, runBoundedSignup } from "./controller.ts";
import { decryptV2 } from "./vault.ts";
import { fakeProvider } from "./providers/fake.ts";
import { browserbaseProvider } from "./providers/browserbase.ts";
import {
  onboardingFixtureEnabled,
  redditAssistedSignupEnabled,
  redditBrowserProvider,
  assistedApprovalStatus,
} from "./config.ts";
import { claimCleanup, runCleanupTask, expireRetainedProfiles, type OauthRevoker } from "./cleanup.ts";

export function selectProvider(): BrowserProvider {
  return redditBrowserProvider() === "browserbase" ? browserbaseProvider : fakeProvider;
}

export const redditOauthRevoker: OauthRevoker = async (material, meta) => {
  try {
    const token = decryptV2(material, {
      userId: meta.userId,
      recordId: meta.accountId || meta.userId,
      purpose: "oauth_revocation_material",
    });
    const [{ getApp }, { revokeToken }, { userAgentFor }] = await Promise.all([
      import("../store.ts"),
      import("../oauth.ts"),
      import("../naming.ts"),
    ]);
    const app = await getApp(meta.userId);
    if (!app) return { ok: false };
    await revokeToken({
      clientId: app.client_id,
      clientSecret: app.client_secret,
      userAgent: userAgentFor(app.user_agent_name, app.app_id || "desk.mail"),
      token,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
};

function ambiguousAlloc(err: unknown): boolean {
  if (err instanceof BrowserProviderError) {
    return (
      err.code === "PROVIDER_TIMEOUT" ||
      err.code === "SESSION_AMBIGUOUS" ||
      err.code === "UNKNOWN_STATUS" ||
      err.code === "PROVIDER_UNAVAILABLE"
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|aborted|network|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR|socket/i.test(msg);
}

export type DrainOpts = {
  userId?: string;
  jobId?: string;
  revokeOauth?: OauthRevoker;
};

export async function drainOnce(
  sql: SqlLike,
  workerId: string,
  provider: BrowserProvider = selectProvider(),
  opts?: DrainOpts,
): Promise<{ didWork: boolean }> {
  const scoped = Boolean(opts?.userId && opts?.jobId);
  if (!scoped) {
    await expireRetainedProfiles(sql);
    const cleanup = await claimCleanup(sql, workerId).catch(() => null);
    if (cleanup) {
      await runCleanupTask(sql, cleanup, provider, opts?.revokeOauth ?? redditOauthRevoker);
      return { didWork: true };
    }
  }
  const claimed = await claimCommand(
    sql,
    workerId,
    60,
    scoped ? { userId: opts!.userId!, jobId: opts!.jobId! } : undefined,
  );
  if (!claimed) return { didWork: false };
  if (
    (opts?.userId && claimed.command.user_id !== opts.userId) ||
    (opts?.jobId && claimed.command.job_id !== opts.jobId)
  ) {
    await sql.query(
      `update reddit_onboarding_commands
          set status = 'queued', lease_owner = null, lease_until = null
        where id = $1 and lease_owner = $2`,
      [claimed.command.id, workerId],
    );
    return { didWork: false };
  }
  const { command, job } = claimed;
  try {
    await handleCommand(sql, command, job, workerId, provider);
    await completeCommand(sql, command.id, workerId, Number(command.lease_generation));
  } catch (err) {
    const code = err instanceof BrowserProviderError ? err.code : "WORKER_ERROR";
    await completeCommand(sql, command.id, workerId, Number(command.lease_generation), code);
  }
  return { didWork: true };
}

async function persistAllocationIntent(
  sql: SqlLike,
  job: JobRow,
  providerName: string,
): Promise<{ intentId: string; contextId: string | null; reconciling: boolean }> {
  const fingerprint = `session:${job.id}:${job.session_generation}`;
  const lookup = job.allocation_intent_id
    ? await sql.query<{
        id: string;
        provider_context_id: string | null;
        status: string;
      }>(
        `select id, provider_context_id, status from reddit_allocation_intents where id = $1 limit 1`,
        [job.allocation_intent_id],
      )
    : await sql.query<{
        id: string;
        provider_context_id: string | null;
        status: string;
      }>(
        `select id, provider_context_id, status from reddit_allocation_intents
          where user_id = $1 and job_id = $2 and kind = 'session' and request_fingerprint = $3
          limit 1`,
        [job.user_id, job.id, fingerprint],
      );
  if (lookup[0]) {
    return {
      intentId: lookup[0].id,
      contextId: lookup[0].provider_context_id || job.provider_context_id || null,
      reconciling: lookup[0].status === "reconciling",
    };
  }
  const intentId = crypto.randomUUID();
  await sql.query(
    `insert into reddit_allocation_intents (
       id, user_id, job_id, kind, status, provider, request_fingerprint
     ) values ($1,$2,$3,'session','requested',$4,$5)
     on conflict (user_id, job_id, kind, request_fingerprint) do nothing`,
    [intentId, job.user_id, job.id, providerName, fingerprint],
  );
  const rows = await sql.query<{
    id: string;
    provider_context_id: string | null;
    status: string;
  }>(
    `select id, provider_context_id, status from reddit_allocation_intents
      where user_id = $1 and job_id = $2 and kind = 'session' and request_fingerprint = $3
      limit 1`,
    [job.user_id, job.id, fingerprint],
  );
  const row = rows[0];
  const resolvedId = row?.id || intentId;
  await sql.query(
    `update reddit_onboarding_jobs
        set allocation_intent_id = $1, allocation_status = 'requested'
      where id = $2 and user_id = $3 and (allocation_intent_id is null or allocation_intent_id = $1)`,
    [resolvedId, job.id, job.user_id],
  );
  return {
    intentId: resolvedId,
    contextId: row?.provider_context_id || job.provider_context_id || null,
    reconciling: row?.status === "reconciling",
  };
}

async function markAmbiguous(
  sql: SqlLike,
  job: JobRow,
  workerId: string,
  leaseGeneration: number,
  expectedVersion: number,
  intentId: string,
  contextId: string | null,
  code: string,
) {
  await sql.query(
    `update reddit_allocation_intents
        set status = 'reconciling', error_code = $2, updated_at = now()
      where id = $1`,
    [intentId, code],
  );
  await transitionJob(sql, {
    userId: job.user_id,
    jobId: job.id,
    expectedVersion,
    leaseOwner: workerId,
    leaseGeneration,
    event: { type: "SUBMIT_LOST" },
    eventType: "result_unknown",
    patch: {
      allocation_intent_id: intentId,
      allocation_status: "reconciling",
      provider_context_id: contextId,
      error_code: "SESSION_AMBIGUOUS",
    },
  });
}

async function handleCommand(
  sql: SqlLike,
  command: CommandRow,
  job: JobRow,
  workerId: string,
  provider: BrowserProvider,
) {
  let leaseGeneration = Number(job.lease_generation);
  const fence = () => ({ leaseOwner: workerId, leaseGeneration });
  const caps = capabilities({
    assistanceConsent: Boolean(job.assistance_consent_at),
    approvalStatus: assistedApprovalStatus(),
  });
  if (command.kind === "cancel") {
    if (isTerminal(job.status) && job.status !== "blocked") {
      return;
    }
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: { type: "OWNER_CANCELS" },
      eventType: "cancelled",
      patch: { cleanup_summary: "Browser cleanup pending." },
    });
    if (job.provider_session_id) {
      await enqueueCleanup(sql, {
        userId: job.user_id,
        jobId: job.id,
        kind: "release_session",
        target: job.provider_session_id,
      });
    }
    if (job.provider_context_id) {
      await enqueueCleanup(sql, {
        userId: job.user_id,
        jobId: job.id,
        kind: "delete_context",
        target: job.provider_context_id,
      });
    }
    return;
  }

  if (command.kind === "confirm_submit") {
    if (
      irreversibleSubmitBlocked({
        status: job.status,
        step: job.step,
        version: Number(job.version),
        mode: job.mode,
        intent: job.intent,
        creationOutcome: job.creation_outcome,
        connectionState: job.connection_state,
        controlOwner: job.control_owner,
        cancelRequested: Boolean(job.cancel_requested_at),
        submitSideEffect:
          job.submit_started_at && !job.submit_result_at
            ? "started"
            : job.submit_intent_id
              ? "prepared"
              : null,
      })
    ) {
      await transitionJob(sql, {
        userId: job.user_id,
        jobId: job.id,
        expectedVersion: Number(job.version),
        ...fence(),
        event: { type: "SUBMIT_LOST" },
        eventType: "result_unknown",
      });
      return;
    }
    await sql.query(
      `update reddit_onboarding_commands
          set side_effect_status = 'started', side_effect_started_at = now()
        where id = $1 and (side_effect_status is null or side_effect_status = 'prepared')`,
      [command.id],
    );
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: { type: "SUBMIT_LOST" },
      eventType: "result_unknown",
      details: { reason: "submit_not_replayed" },
    });
    return;
  }

  if (command.kind === "request_takeover") {
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: { type: "VERIFICATION_NEEDED", reason: "takeover" },
      eventType: "control_granted",
      patch: { control_owner: "user", wait_reason: "You have control of the browser." },
    });
    return;
  }

  if (command.kind === "end_takeover") {
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: { type: "OWNER_RETURNS_CONTROL" },
      eventType: "control_ended",
    });
    return;
  }

  if (command.kind === "reconcile") {
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: {
        type: "RECONCILED",
        outcome: job.creation_outcome === "unknown" ? "unknown" : job.creation_outcome,
      },
      eventType: "result_unknown",
    });
    return;
  }

  if (command.kind === "handoff_manual") {
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: { type: "HANDOFF_TO_MANUAL" },
      eventType: "handoff_manual",
      patch: {
        cleanup_summary: job.provider_session_id
          ? "Hosted browser cleanup pending. History is kept on this setup."
          : "Switched this setup to manual. History is kept.",
      },
    });
    if (job.provider_session_id) {
      await enqueueCleanup(sql, {
        userId: job.user_id,
        jobId: job.id,
        kind: "release_session",
        target: job.provider_session_id,
      });
    }
    if (job.provider_context_id) {
      await enqueueCleanup(sql, {
        userId: job.user_id,
        jobId: job.id,
        kind: "delete_context",
        target: job.provider_context_id,
      });
    }
    return;
  }

  if (command.kind !== "start" && command.kind !== "continue") return;

  if (job.mode !== "assisted") {
    if (job.status === "draft") {
      await transitionJob(sql, {
        userId: job.user_id,
        jobId: job.id,
        expectedVersion: Number(job.version),
        ...fence(),
        event: { type: "OWNER_STARTS" },
        eventType: "started",
      });
    }
    return;
  }

  if (!caps.canStartAssistedSignup || !redditAssistedSignupEnabled()) {
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: { type: "PERMISSION_REVOKED" },
      eventType: "cancelled",
      patch: { error_code: "ASSISTED_DISABLED", error_summary: "Guided setup is not enabled." },
    });
    return;
  }

  if (job.workflow_version && job.workflow_version !== pinWorkflowVersion()) {
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: { type: "UNSUPPORTED_PAGE" },
      eventType: "unsupported_page",
      patch: {
        error_code: "WORKFLOW_PIN_MISMATCH",
        error_summary: "This setup is pinned to another workflow version.",
      },
    });
    return;
  }

  const allocation = await persistAllocationIntent(sql, job, provider.name);
  if (allocation.reconciling) {
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      ...fence(),
      event: { type: "SUBMIT_LOST" },
      eventType: "result_unknown",
      patch: {
        allocation_intent_id: allocation.intentId,
        allocation_status: "reconciling",
        error_code: "SESSION_AMBIGUOUS",
      },
    });
    return;
  }

  await insertEvent(sql, {
    userId: job.user_id,
    jobId: job.id,
    type: "session_allocation_requested",
    actorKind: "worker",
    actorId: workerId,
    jobVersion: Number(job.version),
    details: { allocationIntentId: allocation.intentId },
  });

  let contextId = allocation.contextId;
  if (!contextId) {
    try {
      const ctx = await provider.createContext({
        jobId: job.id,
        userId: job.user_id,
        environmentId: job.environment_id || "preview",
      });
      contextId = ctx.contextId;
    } catch (err) {
      if (ambiguousAlloc(err)) {
        const code = err instanceof BrowserProviderError ? err.code : "PROVIDER_TIMEOUT";
        await markAmbiguous(
          sql,
          job,
          workerId,
          leaseGeneration,
          Number(job.version),
          allocation.intentId,
          null,
          code,
        );
        return;
      }
      throw err;
    }
    await sql.query(
      `update reddit_allocation_intents
          set provider_context_id = $1, updated_at = now()
        where id = $2`,
      [contextId, allocation.intentId],
    );
    await sql.query(
      `update reddit_onboarding_jobs
          set provider_context_id = $1, allocation_intent_id = $2, allocation_status = 'context_created'
        where id = $3 and user_id = $4`,
      [contextId, allocation.intentId, job.id, job.user_id],
    );
  }

  const afterContext = await getJob(sql, job.user_id, job.id);
  if (afterContext?.cancel_requested_at || afterContext?.finished_at) {
    await enqueueCleanup(sql, {
      userId: job.user_id,
      jobId: job.id,
      kind: "delete_context",
      target: contextId,
    });
    return;
  }

  const renewed = await renewLease(sql, {
    userId: job.user_id,
    jobId: job.id,
    workerId,
    generation: leaseGeneration,
  });
  leaseGeneration = Number(renewed.lease_generation);
  const expectedVersion = Number(renewed.version);

  let session;
  try {
    session = await provider.createSession({
      jobId: job.id,
      allocationIntentId: allocation.intentId,
      contextId,
      generation: Number(job.session_generation) + 1,
      policy: { ...DEFAULT_SESSION_POLICY, timeoutSeconds: sessionBudgetSeconds() },
    });
  } catch (err) {
    if (ambiguousAlloc(err)) {
      const code = err instanceof BrowserProviderError ? err.code : "PROVIDER_TIMEOUT";
      await markAmbiguous(sql, job, workerId, leaseGeneration, expectedVersion, allocation.intentId, contextId, code);
      return;
    }
    throw err;
  }

  await sql.query(
    `update reddit_allocation_intents
        set provider_session_id = $1, status = 'confirmed', updated_at = now()
      where id = $2`,
    [session.sessionId, allocation.intentId],
  );

  await transitionJob(sql, {
    userId: job.user_id,
    jobId: job.id,
    expectedVersion,
    ...fence(),
    event: { type: "LEASE_ACQUIRED" },
    eventType: "session_allocation_confirmed",
    patch: {
      provider_session_id: session.sessionId,
      allocation_intent_id: allocation.intentId,
      allocation_status: "confirmed",
      provider_context_id: contextId,
      reserved_browser_seconds: sessionBudgetSeconds(),
    },
  });

  const fresh = await getJob(sql, job.user_id, job.id);
  if (!fresh) return;
  if (fresh.cancel_requested_at) {
    await enqueueCleanup(sql, {
      userId: job.user_id,
      jobId: job.id,
      kind: "release_session",
      target: session.sessionId,
    });
    if (contextId) {
      await enqueueCleanup(sql, {
        userId: job.user_id,
        jobId: job.id,
        kind: "delete_context",
        target: contextId,
      });
    }
    return;
  }

  const signupUrl = onboardingFixtureEnabled() ? fixtureSignupUrl() : REVIEWED_SIGNUP_URL;
  const steps = plannedSteps({
    signupUrl,
    expectedUsername: fresh.expected_username || "",
  });
  for (const step of steps) {
    const allowed = validatePlannedAction(step.action, "create_account");
    if (!allowed.ok) {
      await transitionJob(sql, {
        userId: job.user_id,
        jobId: job.id,
        expectedVersion: Number(fresh.version),
        leaseOwner: workerId,
        leaseGeneration: Number(fresh.lease_generation),
        event: { type: "UNSUPPORTED_PAGE" },
        eventType: "unsupported_page",
        patch: { error_code: allowed.code },
      });
      return;
    }
  }

  if (onboardingFixtureEnabled()) {
    const driver = new FakePageDriver();
    const plan = steps
      .filter((s) => s.id !== "fill_email" && (s.id !== "fill_username" || Boolean(fresh.expected_username)))
      .map((s) => ({
        action: s.action,
        value: s.id === "fill_username" ? fresh.expected_username || undefined : undefined,
      }));
    const observation = await runBoundedSignup(driver, plan, {
      fixtureMode: true,
      fillValues: { username: fresh.expected_username || undefined },
      step: "create_account",
    });
    if (observation.errorCode === "UNSUPPORTED_PAGE_VARIANT" || observation.errorCode === "FIXTURE_LEAK") {
      await transitionJob(sql, {
        userId: job.user_id,
        jobId: job.id,
        expectedVersion: Number(fresh.version),
        leaseOwner: workerId,
        leaseGeneration: Number(fresh.lease_generation),
        event: { type: "UNSUPPORTED_PAGE" },
        eventType: "unsupported_page",
        patch: { error_code: observation.errorCode },
      });
      return;
    }
  }

  await transitionJob(sql, {
    userId: job.user_id,
    jobId: job.id,
    expectedVersion: Number(fresh.version),
    leaseOwner: workerId,
    leaseGeneration: Number(fresh.lease_generation),
    event: { type: "VERIFICATION_NEEDED", reason: "owner_must_verify" },
    eventType: "user_action_required",
    patch: { wait_reason: "Reddit needs you to verify before the account exists." },
  });
}

/** Owner-scoped preview drain. Never impersonates the global dispatcher. */
export async function drainOwnedPreview(sql: SqlLike, userId: string, jobId: string) {
  if (!userId || !jobId) return;
  if (redditBrowserProvider() !== "fake") return;
  for (let i = 0; i < 3; i += 1) {
    const { didWork } = await drainOnce(sql, `preview-drain:${userId.slice(0, 12)}`, fakeProvider, {
      userId,
      jobId,
    });
    if (!didWork) break;
  }
}
