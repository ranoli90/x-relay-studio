import { newId } from "../../agent/ids.ts";
import {
  ACCOUNT_CAP,
  ASSISTANCE_CONSENT_VERSION,
  OnboardingError,
  type CommandKind,
  type ConnectionState,
  type CreationOutcome,
  type JobIntent,
  type JobMode,
  type JobStatus,
  type JobStep,
  type OnboardingEventPublic,
  type OnboardingJobPublic,
  type PermittedAction,
  type ResumeCandidate,
} from "./types.ts";
import { applyEvent, canExecuteCommand, isTerminal, permittedActions, type MachineJob } from "./machine.ts";
import { capabilities, assistedUnavailableReason } from "./policy.ts";
import { hashFingerprint, hashIdempotency, sha256Hex } from "./vault.ts";
import { redactValue, type SafeEventType } from "./observability.ts";
import type { SqlLike } from "./sql.ts";
import { isUniqueViolation, withSqlTransaction } from "./sql.ts";
import { environmentId, redditSessionMaxSeconds, redditWorkflowVersion } from "./config.ts";

export type JobRow = {
  id: string;
  user_id: string;
  predecessor_job_id: string | null;
  mode: JobMode;
  intent: JobIntent;
  status: JobStatus;
  step: JobStep;
  connection_state: ConnectionState;
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
  finished_at: string | Date | null;
  last_activity_at: string | Date;
  wait_reason: string | null;
  wait_deadline_at: string | Date | null;
  creation_outcome: CreationOutcome;
  expected_username: string | null;
  verified_reddit_id: string | null;
  verified_username: string | null;
  identity_evidence_kind: string | null;
  identity_verified_at: string | Date | null;
  account_id: string | null;
  browser_profile_id: string | null;
  provider_session_id: string | null;
  session_generation: number;
  provider_expires_at: string | Date | null;
  control_owner: "worker" | "user" | "none";
  assistance_consent_version: string | null;
  assistance_consent_at: string | Date | null;
  retain_context: boolean;
  retain_password: boolean;
  consent_receipt_id: string | null;
  workflow_version: string | null;
  app_credential_version: number | null;
  use_case_version: string | null;
  environment_id: string | null;
  submit_intent_id: string | null;
  submit_started_at: string | Date | null;
  submit_result_at: string | Date | null;
  cancel_requested_at: string | Date | null;
  error_code: string | null;
  error_summary: string | null;
  lease_owner: string | null;
  lease_generation: number;
  lease_until: string | Date | null;
  heartbeat_at: string | Date | null;
  attempt_count: number;
  next_action_at: string | Date | null;
  reserved_browser_seconds: number;
  consumed_browser_seconds: number;
  model_call_count: number;
  budget_version: number;
  allocation_intent_id: string | null;
  masked_email: string | null;
  cleanup_summary: string | null;
  allocation_status?: string | null;
  provider_context_id?: string | null;
  handoff_from_mode?: string | null;
  retention_status?: string | null;
  retention_expires_at?: string | Date | null;
  batch_id?: string | null;
  batch_size?: number;
  batch_index?: number;
};

export type CommandRow = {
  id: string;
  user_id: string;
  job_id: string;
  kind: CommandKind;
  idempotency_key_hash: string;
  request_fingerprint: string;
  expected_job_version: number;
  payload_json: string;
  status: string;
  attempt: number;
  available_at: string | Date;
  lease_owner: string | null;
  lease_generation: number;
  lease_until: string | Date | null;
  created_at: string | Date;
  completed_at: string | Date | null;
  error_code: string | null;
  side_effect_status: string | null;
  side_effect_started_at: string | Date | null;
  side_effect_result_at: string | Date | null;
};

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function asMachine(row: JobRow): MachineJob {
  return {
    status: row.status,
    step: row.step,
    version: Number(row.version),
    mode: row.mode,
    intent: row.intent,
    creationOutcome: row.creation_outcome,
    connectionState: row.connection_state,
    controlOwner: row.control_owner,
    cancelRequested: Boolean(row.cancel_requested_at),
    submitSideEffect: (row.submit_intent_id
      ? ((row.submit_started_at && !row.submit_result_at && "started") ||
          (row.submit_result_at && "confirmed") ||
          "prepared")
      : null) as MachineJob["submitSideEffect"],
  };
}

export function toPublicJob(
  row: JobRow,
  opts: { appConfigured: boolean; approvalStatus?: string },
): OnboardingJobPublic {
  const caps = capabilities({
    appConfigured: opts.appConfigured,
    approvalStatus: opts.approvalStatus,
    assistanceConsent: Boolean(row.assistance_consent_at),
  });
  const machine = asMachine(row);
  const actions: PermittedAction[] = permittedActions(machine, {
    assisted: caps.canStartAssistedSignup,
    oauth: caps.canStartOAuth,
    appReady: opts.appConfigured,
  });
  return {
    id: row.id,
    mode: row.mode,
    intent: row.intent,
    status: row.status,
    step: row.step,
    version: Number(row.version),
    expectedUsername: row.expected_username,
    verifiedUsername: row.verified_username,
    accountId: row.account_id,
    controlOwner: row.control_owner,
    creationOutcome: row.creation_outcome,
    connectionState: row.connection_state,
    waitReason: row.wait_reason,
    waitDeadlineAt: iso(row.wait_deadline_at),
    lastActivityAt: iso(row.last_activity_at) || new Date().toISOString(),
    finishedAt: iso(row.finished_at),
    cleanupSummary: row.cleanup_summary,
    errorCode: row.error_code,
    errorSummary: row.error_summary,
    maskedEmail: row.masked_email,
    retainContext: Boolean(row.retain_context),
    retainPassword: Boolean(row.retain_password),
    retentionStatus: row.retention_status ?? (row.retain_context ? "requested" : null),
    retentionExpiresAt: iso(row.retention_expires_at ?? null),
    cleanupPending: Boolean(row.cleanup_summary && /pending/i.test(row.cleanup_summary)),
    permittedActions: actions,
    capabilities: caps,
    batchId: row.batch_id ?? null,
    batchSize: Number(row.batch_size ?? 1),
    batchIndex: Number(row.batch_index ?? 1),
  };
}

export async function getJob(sql: SqlLike, userId: string, jobId: string): Promise<JobRow | null> {
  const rows = await sql.query<JobRow>(
    `select * from reddit_onboarding_jobs where id = $1 and user_id = $2 limit 1`,
    [jobId, userId],
  );
  return rows[0] ?? null;
}

export async function getActiveJob(sql: SqlLike, userId: string): Promise<JobRow | null> {
  const rows = await sql.query<JobRow>(
    `select * from reddit_onboarding_jobs
      where user_id = $1 and finished_at is null
      order by updated_at desc limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function listResumeCandidates(
  sql: SqlLike,
  userId: string,
): Promise<ResumeCandidate[]> {
  const jobs = await sql.query<JobRow>(
    `select * from reddit_onboarding_jobs
      where user_id = $1 and finished_at is null
      order by updated_at desc`,
    [userId],
  );
  const pending = await sql.query<{ id: string; name: string }>(
    `select id, name from reddit_accounts
      where user_id = $1 and onboarded_at is null and coalesce(disabled_at, disconnected_at) is null
      order by created_at desc`,
    [userId],
  );
  const out: ResumeCandidate[] = jobs.map((j) => ({
    kind: "job",
    id: j.id,
    label: j.expected_username ? `Continue setup for u/${j.expected_username}` : "Continue Reddit setup",
    status: j.status,
  }));
  for (const p of pending) {
    out.push({
      kind: "unconfirmed_account",
      id: p.id,
      label: `Finish connecting u/${p.name}`,
      status: "unconfirmed",
    });
  }
  return out;
}

export async function createOrReuseDraft(
  sql: SqlLike,
  opts: {
    userId: string;
    mode: JobMode;
    intent: JobIntent;
    expectedUsername?: string;
    idempotencyKey: string;
    body: unknown;
    waitReason?: string | null;
    batchId?: string | null;
    batchSize?: number;
    batchIndex?: number;
    predecessorJobId?: string | null;
  },
): Promise<{ job: JobRow; reused: boolean }> {
  const hash = hashIdempotency(opts.userId, "createOnboarding", opts.idempotencyKey);
  const fp = hashFingerprint(opts.body);
  const existingCmd = await sql.query<CommandRow>(
    `select * from reddit_onboarding_commands
      where user_id = $1 and idempotency_key_hash = $2
      limit 1`,
    [opts.userId, hash],
  );
  if (existingCmd[0]) {
    if (existingCmd[0].request_fingerprint !== fp) {
      throw new OnboardingError("IDEMPOTENCY_CONFLICT", "This request was already sent with different details.", 409);
    }
    const job = await getJob(sql, opts.userId, existingCmd[0].job_id);
    if (job) return { job, reused: true };
  }

  const active = await getActiveJob(sql, opts.userId);
  if (active) {
    if (active.mode === opts.mode && active.intent === opts.intent && active.status === "draft") {
      return { job: active, reused: true };
    }
    throw new OnboardingError(
      "ACTIVE_JOB_EXISTS",
      "Finish or cancel the open Reddit setup before starting another.",
      409,
    );
  }

  const id = crypto.randomUUID();
  try {
    return await withSqlTransaction(sql, async (tx) => {
      const rows = await tx.query<JobRow>(
        `insert into reddit_onboarding_jobs (
           id, user_id, mode, intent, status, step, connection_state, version,
           workflow_version, use_case_version, environment_id, expected_username,
           wait_reason, batch_id, batch_size, batch_index, predecessor_job_id
         ) values (
           $1, $2, $3, $4, 'draft', 'consent', 'not_started', 1,
           $5, 'data-api-v1', $6, $7, $8, $9, $10, $11, $12
         ) returning *`,
        [
          id,
          opts.userId,
          opts.mode,
          opts.intent,
          redditWorkflowVersion(),
          environmentId(),
          opts.expectedUsername ?? null,
          opts.waitReason ?? null,
          opts.batchId ?? null,
          opts.batchSize ?? 1,
          opts.batchIndex ?? 1,
          opts.predecessorJobId ?? null,
        ],
      );
      const job = rows[0];
      await tx.query(
        `insert into reddit_onboarding_commands (
           id, user_id, job_id, kind, idempotency_key_hash, request_fingerprint,
           expected_job_version, payload_json, status
         ) values ($1,$2,$3,'start',$4,$5,1,'{}','completed')`,
        [crypto.randomUUID(), opts.userId, id, hash, fp],
      );
      await insertEvent(tx, {
        userId: opts.userId,
        jobId: id,
        type: "job_created",
        actorKind: "owner",
        actorId: opts.userId,
        jobVersion: 1,
        details: {
          mode: opts.mode,
          intent: opts.intent,
          batchId: opts.batchId ?? null,
          batchIndex: opts.batchIndex ?? 1,
        },
      });
      return { job, reused: false };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await getActiveJob(sql, opts.userId);
      if (again) {
        if (again.mode !== opts.mode || again.intent !== opts.intent) {
          throw new OnboardingError(
            "ACTIVE_JOB_EXISTS",
            "Finish or cancel the open Reddit setup before starting another.",
            409,
          );
        }
        return { job: again, reused: true };
      }
      throw new OnboardingError("ACTIVE_JOB_EXISTS", "Finish or cancel the open Reddit setup before starting another.", 409);
    }
    throw err;
  }
}

export async function saveDetails(
  sql: SqlLike,
  opts: {
    userId: string;
    jobId: string;
    version: number;
    expectedUsername?: string;
    retainContext: boolean;
    retainPassword: boolean;
    assistanceConsent: boolean;
    maskedEmail?: string | null;
  },
): Promise<JobRow> {
  const job = await requireJob(sql, opts.userId, opts.jobId, opts.version);
  if (job.status !== "draft" && job.status !== "needs_user") {
    throw new OnboardingError("UNSUPPORTED_STATE", "Details can only be saved on a draft setup.");
  }
  const rows = await sql.query<JobRow>(
    `update reddit_onboarding_jobs set
       expected_username = coalesce($3, expected_username),
       retain_context = $4,
       retain_password = $5,
       assistance_consent_version = $6,
       assistance_consent_at = case when $7 then now() else assistance_consent_at end,
       masked_email = coalesce($8, masked_email),
       version = version + 1,
       updated_at = now(),
       last_activity_at = now()
     where id = $1 and user_id = $2 and version = $9
     returning *`,
    [
      opts.jobId,
      opts.userId,
      opts.expectedUsername ?? null,
      opts.retainContext,
      opts.retainPassword,
      opts.assistanceConsent ? ASSISTANCE_CONSENT_VERSION : job.assistance_consent_version,
      opts.assistanceConsent,
      opts.maskedEmail ?? null,
      opts.version,
    ],
  );
  if (!rows[0]) throw stale(job);
  await insertEvent(sql, {
    userId: opts.userId,
    jobId: opts.jobId,
    type: "details_saved",
    actorKind: "owner",
    actorId: opts.userId,
    jobVersion: rows[0].version,
    details: { retainContext: opts.retainContext, retainPassword: opts.retainPassword },
  });
  return rows[0];
}

export async function enqueueCommand(
  sql: SqlLike,
  opts: {
    userId: string;
    jobId: string;
    version: number;
    kind: CommandKind;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    operation: string;
  },
): Promise<{ command: CommandRow; job: JobRow; duplicate: boolean }> {
  const hash = hashIdempotency(opts.userId, opts.operation, opts.idempotencyKey);
  const fp = hashFingerprint(opts.payload);
  const existing = await sql.query<CommandRow>(
    `select * from reddit_onboarding_commands
      where user_id = $1 and job_id = $2 and idempotency_key_hash = $3
      limit 1`,
    [opts.userId, opts.jobId, hash],
  );
  if (existing[0]) {
    if (existing[0].request_fingerprint !== fp) {
      throw new OnboardingError("IDEMPOTENCY_CONFLICT", "This retry does not match the original request.", 409);
    }
    const job = await getJob(sql, opts.userId, opts.jobId);
    if (!job) throw new OnboardingError("NOT_FOUND", "Setup not found.", 404);
    return { command: existing[0], job, duplicate: true };
  }
  const job = await requireJob(sql, opts.userId, opts.jobId, opts.version);
  if (!canExecuteCommand(asMachine(job), opts.kind)) {
    throw new OnboardingError("UNSUPPORTED_STATE", `Cannot ${opts.kind} from ${job.status}.`);
  }
  const rows = await sql.query<CommandRow>(
    `insert into reddit_onboarding_commands (
       id, user_id, job_id, kind, idempotency_key_hash, request_fingerprint,
       expected_job_version, payload_json, status
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,'queued')
     returning *`,
    [
      crypto.randomUUID(),
      opts.userId,
      opts.jobId,
      opts.kind,
      hash,
      fp,
      opts.version,
      JSON.stringify(redactValue(opts.payload)),
    ],
  );
  return { command: rows[0], job, duplicate: false };
}

export async function transitionJob(
  sql: SqlLike,
  opts: {
    userId: string;
    jobId: string;
    expectedVersion: number;
    leaseOwner?: string;
    leaseGeneration?: number;
    event: Parameters<typeof applyEvent>[1];
    patch?: Partial<{
      expected_username: string | null;
      verified_username: string | null;
      verified_reddit_id: string | null;
      identity_evidence_kind: string | null;
      account_id: string | null;
      wait_reason: string | null;
      error_code: string | null;
      error_summary: string | null;
      cleanup_summary: string | null;
      allocation_intent_id: string | null;
      provider_session_id: string | null;
      provider_context_id: string | null;
      browser_profile_id: string | null;
      control_owner: string;
      reserved_browser_seconds: number;
      submit_intent_id: string | null;
      allocation_status: string | null;
    }>;
    eventType: SafeEventType;
    details?: Record<string, unknown>;
  },
): Promise<JobRow> {
  const job = await requireJob(sql, opts.userId, opts.jobId, opts.expectedVersion);
  if (opts.leaseOwner) {
    if (job.lease_owner && job.lease_owner !== opts.leaseOwner) {
      throw new OnboardingError("STALE_LEASE", "Another worker owns this setup.", 409, job.version);
    }
    if (opts.leaseGeneration != null && Number(job.lease_generation) !== opts.leaseGeneration) {
      throw new OnboardingError("STALE_LEASE", "This worker lease is no longer valid.", 409, job.version);
    }
  }
  const next = applyEvent(asMachine(job), opts.event);
  const finished = isTerminal(next.status) ? new Date().toISOString() : null;
  const rows = await sql.query<JobRow>(
    `update reddit_onboarding_jobs set
       status = $3,
       step = $4,
       connection_state = $5,
       creation_outcome = $6,
       control_owner = $7,
       version = $8,
       finished_at = coalesce($9::timestamptz, finished_at),
       cancel_requested_at = case when $10 then coalesce(cancel_requested_at, now()) else cancel_requested_at end,
       expected_username = coalesce($11, expected_username),
       verified_username = coalesce($12, verified_username),
       verified_reddit_id = coalesce($13, verified_reddit_id),
       identity_evidence_kind = coalesce($14, identity_evidence_kind),
       identity_verified_at = case when $13 is not null then now() else identity_verified_at end,
       account_id = coalesce($15, account_id),
       wait_reason = $16,
       error_code = $17,
       error_summary = $18,
       cleanup_summary = coalesce($19, cleanup_summary),
       allocation_intent_id = coalesce($20, allocation_intent_id),
       provider_session_id = coalesce($21, provider_session_id),
       browser_profile_id = coalesce($22, browser_profile_id),
       reserved_browser_seconds = coalesce($23, reserved_browser_seconds),
       submit_intent_id = coalesce($24, submit_intent_id),
       mode = coalesce($26, mode),
       provider_context_id = coalesce($27, provider_context_id),
       allocation_status = coalesce($28, allocation_status),
       handoff_from_mode = coalesce($29, handoff_from_mode),
       updated_at = now(),
       last_activity_at = now()
     where id = $1 and user_id = $2 and version = $25
       and (
         $30::text is null
         or (
           lease_owner = $30
           and lease_generation = $31
           and lease_until is not null
           and lease_until > now()
         )
       )
     returning *`,
    [
      opts.jobId,
      opts.userId,
      next.status,
      next.step,
      next.connectionState,
      next.creationOutcome,
      next.controlOwner,
      next.version,
      finished,
      next.cancelRequested,
      opts.patch?.expected_username ?? null,
      opts.patch?.verified_username ?? null,
      opts.patch?.verified_reddit_id ?? null,
      opts.patch?.identity_evidence_kind ?? null,
      opts.patch?.account_id ?? null,
      opts.patch?.wait_reason ?? (next.status === "needs_user" ? job.wait_reason : null),
      opts.patch?.error_code ?? null,
      opts.patch?.error_summary ?? null,
      opts.patch?.cleanup_summary ?? null,
      opts.patch?.allocation_intent_id ?? null,
      opts.patch?.provider_session_id ?? null,
      opts.patch?.browser_profile_id ?? null,
      opts.patch?.reserved_browser_seconds ?? null,
      opts.patch?.submit_intent_id ?? null,
      opts.expectedVersion,
      next.mode,
      opts.patch?.provider_context_id ?? null,
      opts.patch?.allocation_status ?? null,
      opts.event.type === "HANDOFF_TO_MANUAL" ? job.mode : null,
      opts.leaseOwner ?? null,
      opts.leaseGeneration ?? null,
    ],
  );
  if (!rows[0]) {
    if (opts.leaseOwner) {
      throw new OnboardingError("STALE_LEASE", "This worker lease is no longer valid.", 409, job.version);
    }
    throw stale(job);
  }
  await insertEvent(sql, {
    userId: opts.userId,
    jobId: opts.jobId,
    type: opts.eventType,
    actorKind: opts.leaseOwner ? "worker" : "owner",
    actorId: opts.leaseOwner || opts.userId,
    jobVersion: rows[0].version,
    details: opts.details || {},
  });
  return rows[0];
}

export async function claimCommand(
  sql: SqlLike,
  workerId: string,
  leaseSeconds = 60,
  scope?: { userId: string; jobId: string },
): Promise<{ command: CommandRow; job: JobRow } | null> {
  try {
    return await claimCommandOnce(sql, workerId, leaseSeconds, scope, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/skip locked|for update/i.test(msg)) throw err;
    return claimCommandOnce(sql, workerId, leaseSeconds, scope, false);
  }
}

async function claimCommandOnce(
  sql: SqlLike,
  workerId: string,
  leaseSeconds: number,
  scope: { userId: string; jobId: string } | undefined,
  skipLocked: boolean,
): Promise<{ command: CommandRow; job: JobRow } | null> {
  const lock = skipLocked ? "for update skip locked" : "for update";
  return withSqlTransaction(sql, async (tx) => {
    const claimed = await tx.query<CommandRow>(
      `update reddit_onboarding_commands
          set status = 'leased',
              lease_owner = $1,
              lease_generation = lease_generation + 1,
              lease_until = now() + ($2::int * interval '1 second'),
              attempt = attempt + 1
        where id = (
          select c.id from reddit_onboarding_commands c
          join reddit_onboarding_jobs j on j.id = c.job_id and j.user_id = c.user_id
          where c.status in ('queued', 'leased')
            and c.available_at <= now()
            and (c.lease_until is null or c.lease_until <= now() or c.status = 'queued')
            and (j.finished_at is null or c.kind in ('cancel', 'reconcile', 'handoff_manual'))
            and ($3::text is null or c.user_id = $3)
            and ($4::text is null or c.job_id = $4)
            and (
              j.lease_owner is null
              or j.lease_owner = $1
              or j.lease_until is null
              or j.lease_until <= now()
            )
          order by c.available_at
          ${lock}
          limit 1
        )
        returning *`,
      [workerId, leaseSeconds, scope?.userId ?? null, scope?.jobId ?? null],
    );
    const command = claimed[0];
    if (!command) return null;
    const jobRows = await tx.query<JobRow>(
      `update reddit_onboarding_jobs
          set lease_owner = $1,
              lease_generation = lease_generation + 1,
              lease_until = now() + ($2::int * interval '1 second'),
              heartbeat_at = now()
        where id = $3 and user_id = $4
          and (
            lease_owner is null
            or lease_owner = $1
            or lease_until is null
            or lease_until <= now()
          )
        returning *`,
      [workerId, leaseSeconds, command.job_id, command.user_id],
    );
    if (!jobRows[0]) {
      await tx.query(
        `update reddit_onboarding_commands
            set status = 'queued', lease_owner = null, lease_until = null
          where id = $1`,
        [command.id],
      );
      return null;
    }
    return { command, job: jobRows[0] };
  });
}

export async function renewLease(
  sql: SqlLike,
  opts: {
    userId: string;
    jobId: string;
    workerId: string;
    generation: number;
    leaseSeconds?: number;
  },
): Promise<JobRow> {
  const rows = await sql.query<JobRow>(
    `update reddit_onboarding_jobs
        set lease_until = now() + ($5::int * interval '1 second'),
            heartbeat_at = now()
      where id = $1 and user_id = $2
        and lease_owner = $3
        and lease_generation = $4
        and lease_until is not null
        and lease_until > now()
      returning *`,
    [opts.jobId, opts.userId, opts.workerId, opts.generation, opts.leaseSeconds ?? 60],
  );
  if (!rows[0]) {
    throw new OnboardingError("STALE_LEASE", "Lease renewal failed; stop side effects.", 409);
  }
  return rows[0];
}

export async function handoffToManual(
  sql: SqlLike,
  opts: { userId: string; jobId: string; version: number; waitReason?: string | null },
): Promise<JobRow> {
  return withSqlTransaction(sql, async (tx) => {
    const job = await requireJob(tx, opts.userId, opts.jobId, opts.version);
    if (job.mode === "manual" && job.status !== "draft") return job;
    const next = await transitionJob(tx, {
      userId: opts.userId,
      jobId: opts.jobId,
      expectedVersion: opts.version,
      event: { type: "HANDOFF_TO_MANUAL" },
      eventType: "handoff_manual",
      patch: {
        cleanup_summary: job.provider_session_id
          ? "Hosted browser cleanup pending. History is kept on this setup."
          : "Switched this setup to manual. History is kept.",
        wait_reason:
          opts.waitReason ??
          job.wait_reason ??
          (job.intent === "create" ? "Create this Reddit account." : job.wait_reason),
      },
      details: { fromMode: job.mode },
    });
    if (job.provider_session_id) {
      await enqueueCleanup(tx, {
        userId: opts.userId,
        jobId: job.id,
        kind: "release_session",
        target: job.provider_session_id,
      });
    }
    if (job.provider_context_id) {
      await enqueueCleanup(tx, {
        userId: opts.userId,
        jobId: job.id,
        kind: "delete_context",
        target: job.provider_context_id,
      });
    }
    return next;
  });
}

export async function completeCommand(
  sql: SqlLike,
  commandId: string,
  workerId: string,
  generation: number,
  errorCode?: string,
) {
  await sql.query(
    `update reddit_onboarding_commands
        set status = $4,
            completed_at = now(),
            error_code = $5
      where id = $1 and lease_owner = $2 and lease_generation = $3`,
    [commandId, workerId, generation, errorCode ? "failed" : "completed", errorCode ?? null],
  );
}

export async function insertEvent(
  sql: SqlLike,
  opts: {
    userId: string;
    jobId: string;
    type: SafeEventType;
    actorKind: string;
    actorId?: string;
    jobVersion: number;
    details: Record<string, unknown>;
  },
) {
  const seq = await sql.query<{ sequence: number }>(
    `select coalesce(max(sequence), 0) + 1 as sequence
       from reddit_onboarding_events where job_id = $1`,
    [opts.jobId],
  );
  await sql.query(
    `insert into reddit_onboarding_events (
       id, user_id, job_id, sequence, event_type, actor_kind, actor_id,
       job_version, workflow_version, safe_details_json
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      crypto.randomUUID(),
      opts.userId,
      opts.jobId,
      Number(seq[0]?.sequence ?? 1),
      opts.type,
      opts.actorKind,
      opts.actorId ?? null,
      opts.jobVersion,
      redditWorkflowVersion(),
      JSON.stringify(redactValue(opts.details)),
    ],
  );
}

export async function listEvents(
  sql: SqlLike,
  userId: string,
  jobId: string,
  after = 0,
): Promise<OnboardingEventPublic[]> {
  const owned = await getJob(sql, userId, jobId);
  if (!owned) throw new OnboardingError("NOT_FOUND", "Setup not found.", 404);
  const rows = await sql.query<{
    sequence: number;
    event_type: string;
    actor_kind: string;
    occurred_at: string | Date;
    job_version: number;
    safe_details_json: string;
  }>(
    `select sequence, event_type, actor_kind, occurred_at, job_version, safe_details_json
       from reddit_onboarding_events
      where job_id = $1 and user_id = $2 and sequence > $3
      order by sequence
      limit 100`,
    [jobId, userId, after],
  );
  return rows.map((r) => ({
    sequence: Number(r.sequence),
    eventType: r.event_type,
    actorKind: r.actor_kind,
    occurredAt: iso(r.occurred_at) || new Date().toISOString(),
    jobVersion: Number(r.job_version),
    details: safeJson(r.safe_details_json),
  }));
}

export async function enqueueCleanup(
  sql: SqlLike,
  opts: {
    userId: string;
    jobId?: string;
    accountId?: string;
    kind: string;
    target: string;
    generation?: number;
    encryptedMaterial?: string | null;
    parentTaskId?: string | null;
    required?: boolean;
  },
) {
  await sql.query(
    `insert into reddit_cleanup_tasks (
       id, user_id, job_id, account_id, kind, target_reference,
       encrypted_revocation_material, status, generation, parent_task_id, required
     ) values ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10)
     on conflict (user_id, kind, target_reference, generation) do nothing`,
    [
      crypto.randomUUID(),
      opts.userId,
      opts.jobId ?? null,
      opts.accountId ?? null,
      opts.kind,
      opts.target,
      opts.encryptedMaterial ?? null,
      opts.generation ?? 1,
      opts.parentTaskId ?? null,
      opts.required !== false,
    ],
  );
}

export async function countConnectedAccounts(sql: SqlLike, userId: string): Promise<number> {
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from reddit_accounts
      where user_id = $1
        and disconnected_at is null
        and disabled_at is null
        and onboarded_at is not null`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function requireJob(sql: SqlLike, userId: string, jobId: string, version?: number) {
  const job = await getJob(sql, userId, jobId);
  if (!job) throw new OnboardingError("NOT_FOUND", "Setup not found.", 404);
  if (version != null && Number(job.version) !== version) {
    throw stale(job);
  }
  return job;
}

function stale(job: JobRow) {
  return new OnboardingError("STALE_VERSION", "This setup changed. Refresh and try again.", 409, job.version);
}

function safeJson(raw: string): Record<string, string | number | boolean | null> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return {};
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean" || val === null) {
        out[k] = val;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function sessionBudgetSeconds(): number {
  return redditSessionMaxSeconds();
}

export { ACCOUNT_CAP, sha256Hex, newId, assistedUnavailableReason };
