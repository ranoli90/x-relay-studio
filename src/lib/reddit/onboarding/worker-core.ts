import type { SqlLike } from "./sql.ts";
import type { BrowserProvider } from "./provider.ts";
import { DEFAULT_SESSION_POLICY } from "./provider.ts";
import {
  claimCommand,
  completeCommand,
  enqueueCleanup,
  getJob,
  insertEvent,
  sessionBudgetSeconds,
  transitionJob,
  type CommandRow,
  type JobRow,
} from "./store.ts";
import { irreversibleSubmitBlocked, isTerminal } from "./machine.ts";
import { classifyPage, plannedSteps, validatePlannedAction } from "./workflows/email-signup.ts";
import { pinWorkflowVersion } from "./workflows/manifest.ts";
import { capabilities } from "./policy.ts";
import { BrowserProviderError } from "./provider.ts";
import { REVIEWED_SIGNUP_URL } from "./types.ts";
import { fakeProvider } from "./providers/fake.ts";
import { browserbaseProvider } from "./providers/browserbase.ts";
import { redditBrowserProvider, redditAssistedSignupEnabled } from "./config.ts";
import { claimCleanup, runCleanupTask, expireRetainedProfiles } from "./cleanup.ts";

export function selectProvider(): BrowserProvider {
  return redditBrowserProvider() === "browserbase" ? browserbaseProvider : fakeProvider;
}

export async function drainOnce(
  sql: SqlLike,
  workerId: string,
  provider: BrowserProvider = selectProvider(),
): Promise<{ didWork: boolean }> {
  await expireRetainedProfiles(sql);
  const cleanup = await claimCleanup(sql, workerId).catch(() => null);
  if (cleanup) {
    await runCleanupTask(sql, cleanup, provider);
    return { didWork: true };
  }
  let claimed: { command: CommandRow; job: JobRow } | null = null;
  try {
    claimed = await claimCommand(sql, workerId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/skip locked|for update/i.test(msg)) throw err;
    claimed = await claimCommandFallback(sql, workerId);
  }
  if (!claimed) return { didWork: false };
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

async function claimCommandFallback(sql: SqlLike, workerId: string) {
  const rows = await sql.query<CommandRow>(
    `update reddit_onboarding_commands
        set status = 'leased',
            lease_owner = $1,
            lease_generation = lease_generation + 1,
            lease_until = now() + interval '60 seconds',
            attempt = attempt + 1
      where id = (
        select id from reddit_onboarding_commands
         where status in ('queued')
           and available_at <= now()
         order by available_at
         limit 1
      )
      returning *`,
    [workerId],
  );
  const command = rows[0];
  if (!command) return null;
  const jobRows = await sql.query<JobRow>(
    `update reddit_onboarding_jobs
        set lease_owner = $1,
            lease_generation = lease_generation + 1,
            lease_until = now() + interval '60 seconds',
            heartbeat_at = now()
      where id = $2 and user_id = $3
      returning *`,
    [workerId, command.job_id, command.user_id],
  );
  if (!jobRows[0]) return null;
  return { command, job: jobRows[0] };
}

async function handleCommand(
  sql: SqlLike,
  command: CommandRow,
  job: JobRow,
  workerId: string,
  provider: BrowserProvider,
) {
  const caps = capabilities({
    assistanceConsent: Boolean(job.assistance_consent_at),
    approvalStatus: "needs_review",
  });
  if (command.kind === "cancel") {
    if (isTerminal(job.status) && job.status !== "blocked") {
      return;
    }
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(job.version),
      leaseOwner: workerId,
      leaseGeneration: Number(job.lease_generation),
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
    return;
  }

  if (command.kind === "confirm_submit") {
    if (irreversibleSubmitBlocked({
      status: job.status,
      step: job.step,
      version: Number(job.version),
      mode: job.mode,
      intent: job.intent,
      creationOutcome: job.creation_outcome,
      connectionState: job.connection_state,
      controlOwner: job.control_owner,
      cancelRequested: Boolean(job.cancel_requested_at),
      submitSideEffect: job.submit_started_at && !job.submit_result_at ? "started" : job.submit_intent_id ? "prepared" : null,
    })) {
      await transitionJob(sql, {
        userId: job.user_id,
        jobId: job.id,
        expectedVersion: Number(job.version),
        leaseOwner: workerId,
        leaseGeneration: Number(job.lease_generation),
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
      leaseOwner: workerId,
      leaseGeneration: Number(job.lease_generation),
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
      leaseOwner: workerId,
      leaseGeneration: Number(job.lease_generation),
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
      leaseOwner: workerId,
      leaseGeneration: Number(job.lease_generation),
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
      leaseOwner: workerId,
      leaseGeneration: Number(job.lease_generation),
      event: { type: "RECONCILED", outcome: job.creation_outcome === "unknown" ? "unknown" : job.creation_outcome },
      eventType: "result_unknown",
    });
    return;
  }

  if (command.kind !== "start" && command.kind !== "continue") return;

  if (job.mode !== "assisted") {
    if (job.status === "draft") {
      await transitionJob(sql, {
        userId: job.user_id,
        jobId: job.id,
        expectedVersion: Number(job.version),
        leaseOwner: workerId,
        leaseGeneration: Number(job.lease_generation),
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
      leaseOwner: workerId,
      leaseGeneration: Number(job.lease_generation),
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
      leaseOwner: workerId,
      leaseGeneration: Number(job.lease_generation),
      event: { type: "UNSUPPORTED_PAGE" },
      eventType: "unsupported_page",
      patch: { error_code: "WORKFLOW_PIN_MISMATCH", error_summary: "This setup is pinned to another workflow version." },
    });
    return;
  }

  const intentId = job.allocation_intent_id || crypto.randomUUID();
  if (!job.allocation_intent_id) {
    await sql.query(
      `update reddit_onboarding_jobs set allocation_intent_id = $1 where id = $2 and user_id = $3`,
      [intentId, job.id, job.user_id],
    );
  }
  await insertEvent(sql, {
    userId: job.user_id,
    jobId: job.id,
    type: "session_allocation_requested",
    actorKind: "worker",
    actorId: workerId,
    jobVersion: Number(job.version),
    details: { allocationIntentId: intentId },
  });

  const ctx = await provider.createContext({
    jobId: job.id,
    userId: job.user_id,
    environmentId: job.environment_id || "preview",
  });
  let session;
  try {
    session = await provider.createSession({
      jobId: job.id,
      allocationIntentId: intentId,
      contextId: ctx.contextId,
      generation: Number(job.session_generation) + 1,
      policy: { ...DEFAULT_SESSION_POLICY, timeoutSeconds: sessionBudgetSeconds() },
    });
  } catch (err) {
    if (err instanceof BrowserProviderError && err.code === "PROVIDER_TIMEOUT") {
      await transitionJob(sql, {
        userId: job.user_id,
        jobId: job.id,
        expectedVersion: Number(job.version),
        leaseOwner: workerId,
        leaseGeneration: Number(job.lease_generation),
        event: { type: "SUBMIT_LOST" },
        eventType: "result_unknown",
        patch: { allocation_intent_id: intentId, error_code: "SESSION_AMBIGUOUS" },
      });
      return;
    }
    throw err;
  }

  await transitionJob(sql, {
    userId: job.user_id,
    jobId: job.id,
    expectedVersion: Number(job.version),
    leaseOwner: workerId,
    leaseGeneration: Number(job.lease_generation),
    event: { type: "LEASE_ACQUIRED" },
    eventType: "session_allocation_confirmed",
    patch: {
      provider_session_id: session.sessionId,
      allocation_intent_id: intentId,
      reserved_browser_seconds: sessionBudgetSeconds(),
    },
  });

  const fresh = await getJob(sql, job.user_id, job.id);
  if (!fresh) return;
  const steps = plannedSteps({
    signupUrl: REVIEWED_SIGNUP_URL,
    expectedUsername: fresh.expected_username || "user",
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
  const observation = classifyPage({ title: "TEST signup fixture" });
  if (observation.errorCode === "UNSUPPORTED_PAGE_VARIANT") {
    await transitionJob(sql, {
      userId: job.user_id,
      jobId: job.id,
      expectedVersion: Number(fresh.version),
      leaseOwner: workerId,
      leaseGeneration: Number(fresh.lease_generation),
      event: { type: "UNSUPPORTED_PAGE" },
      eventType: "unsupported_page",
    });
    return;
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

export async function drainOwnedPreview(sql: SqlLike, userId: string, jobId: string) {
  if (redditBrowserProvider() !== "fake") return;
  const pending = await sql.query<CommandRow>(
    `select * from reddit_onboarding_commands
      where user_id = $1 and job_id = $2 and status = 'queued'
      order by available_at limit 3`,
    [userId, jobId],
  );
  for (const command of pending) {
    await drainOnce(sql, "preview-drain", fakeProvider);
  }
}
