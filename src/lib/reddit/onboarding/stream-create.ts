import { steelConfigured } from "./config.ts";
import { DEFAULT_SESSION_POLICY } from "./provider.ts";
import { steelProvider } from "./providers/steel.ts";
import { createBrowserProfile, requestRetention } from "./retention.ts";
import type { SqlLike } from "./sql.ts";
import {
  getJob,
  requireJob,
  sessionBudgetSeconds,
  transitionJob,
  type JobRow,
} from "./store.ts";
import { OnboardingError, REVIEWED_SIGNUP_URL } from "./types.ts";

export function streamedCreateReady(): boolean {
  return steelConfigured();
}

/**
 * Open a fresh Steel session in this request and hand the live view to the owner.
 * Does not fill the form, accept terms, or solve a captcha.
 */
export async function startStreamedCreateJob(
  sql: SqlLike,
  opts: { userId: string; jobId: string },
): Promise<JobRow> {
  if (!steelConfigured()) {
    throw new OnboardingError(
      "PROVIDER_NOT_CONFIGURED",
      "Connect Steel Cloud first. That is the hosted browser this desk streams.",
    );
  }
  const job = await requireJob(sql, opts.userId, opts.jobId);
  if (job.provider_session_id && job.status !== "draft") {
    return job;
  }
  if (job.status !== "draft" && job.status !== "queued") {
    return job;
  }

  const session = await steelProvider.createSession({
    jobId: job.id,
    allocationIntentId: job.allocation_intent_id || job.id,
    generation: Number(job.session_generation || 0) + 1,
    persist: true,
    policy: { ...DEFAULT_SESSION_POLICY, timeoutSeconds: sessionBudgetSeconds() },
  });
  await steelProvider.openUrl(session.sessionId, REVIEWED_SIGNUP_URL).catch(() => false);

  const profile = await createBrowserProfile(sql, {
    userId: opts.userId,
    originJobId: job.id,
    provider: "steel",
    providerProjectId: session.projectId,
    providerContextId: session.profileId || session.contextId || session.sessionId,
    lastVerifiedUsername: job.expected_username,
  });
  await requestRetention(sql, { userId: opts.userId, profileId: profile.id }).catch(() => profile);

  const next = await transitionJob(sql, {
    userId: opts.userId,
    jobId: job.id,
    expectedVersion: Number(job.version),
    event: { type: "HANDOFF_TO_MANUAL" },
    eventType: "session_allocation_confirmed",
    patch: {
      provider_session_id: session.sessionId,
      provider_context_id: session.profileId || session.contextId || session.sessionId,
      browser_profile_id: profile.id,
      control_owner: "user",
      reserved_browser_seconds: sessionBudgetSeconds(),
      allocation_status: "confirmed",
      wait_reason: "Create this Reddit account.",
      cleanup_summary: "Fresh hosted browser is open. Profile is kept after you finish.",
    },
    details: {
      streamed: true,
      persistProfile: true,
      profileId: session.profileId || "",
    },
  });

  await sql.query(
    `update reddit_onboarding_jobs
        set retain_context = true,
            control_owner = 'user',
            session_generation = session_generation + 1,
            provider_expires_at = $3,
            updated_at = now()
      where id = $1 and user_id = $2`,
    [job.id, opts.userId, session.expiresAt],
  );

  return (await getJob(sql, opts.userId, job.id)) || next;
}

export async function persistStreamedProfileAfterCreate(
  sql: SqlLike,
  opts: { userId: string; job: JobRow },
): Promise<void> {
  const profileId = opts.job.browser_profile_id;
  if (!profileId) return;
  if (opts.job.provider_session_id) {
    // Steel writes the user-data dir (cookies, login) on release when persistProfile was set.
    await steelProvider.requestRelease(opts.job.provider_session_id).catch(() => undefined);
  }
  await requestRetention(sql, { userId: opts.userId, profileId }).catch(() => undefined);
  const { confirmPersisted } = await import("./retention.ts");
  await confirmPersisted(sql, { userId: opts.userId, profileId }).catch(() => undefined);
}
