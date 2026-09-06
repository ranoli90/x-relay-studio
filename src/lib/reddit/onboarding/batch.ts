import {
  ACCOUNT_CAP,
  CREATE_BATCH_MAX,
  OnboardingError,
  type BatchStatus,
  type OnboardingBatchPublic,
} from "./types.ts";
import {
  createOrReuseDraft,
  getActiveJob,
  getJob,
  insertEvent,
  type JobRow,
} from "./store.ts";
import type { SqlLike } from "./sql.ts";
import {
  browserProviderConfigured,
  onboardingFixtureEnabled,
  redditBrowserProvider,
} from "./config.ts";

export type BatchRow = {
  id: string;
  user_id: string;
  size: number;
  completed_count: number;
  failed_count: number;
  cancelled_count: number;
  status: BatchStatus;
  current_job_id: string | null;
  current_index: number;
  created_at: string | Date;
  updated_at: string | Date;
};

export function generatedCreateUsername(): string {
  return `relay${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function toPublicBatch(row: BatchRow): OnboardingBatchPublic {
  return {
    id: row.id,
    size: Number(row.size),
    completedCount: Number(row.completed_count),
    failedCount: Number(row.failed_count),
    currentIndex: Number(row.current_index),
    status: row.status,
    currentJobId: row.current_job_id,
  };
}

/** Real hosted browser is ready to run a create. Fake is only for the isolated fixture. */
export function hostedBrowserReady(): boolean {
  const provider = redditBrowserProvider();
  if (provider === "fake") return onboardingFixtureEnabled();
  return browserProviderConfigured(provider);
}

export async function countLiveAccounts(sql: SqlLike, userId: string): Promise<number> {
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from reddit_accounts
      where user_id = $1 and disabled_at is null`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

export function remainingCreateSlots(accountCount: number): number {
  return Math.max(0, Math.min(CREATE_BATCH_MAX, ACCOUNT_CAP - accountCount));
}

export async function getBatch(sql: SqlLike, userId: string, batchId: string): Promise<BatchRow | null> {
  const rows = await sql.query<BatchRow>(
    `select * from reddit_onboarding_batches where id = $1 and user_id = $2 limit 1`,
    [batchId, userId],
  );
  return rows[0] ?? null;
}

export async function getOpenBatch(sql: SqlLike, userId: string): Promise<BatchRow | null> {
  const rows = await sql.query<BatchRow>(
    `select * from reddit_onboarding_batches
      where user_id = $1 and status in ('queued', 'running')
      order by updated_at desc limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

function waitCopy(index: number, size: number): string {
  if (size <= 1) return "Making this Reddit account.";
  return `Queued ${size} accounts. Making ${index} of ${size}.`;
}

async function insertCreateJob(
  sql: SqlLike,
  opts: {
    userId: string;
    batchId: string;
    size: number;
    index: number;
    predecessorJobId?: string | null;
    idempotencyKey: string;
  },
): Promise<JobRow> {
  const username = generatedCreateUsername();
  const { job } = await createOrReuseDraft(sql, {
    userId: opts.userId,
    mode: "assisted",
    intent: "create",
    expectedUsername: username,
    idempotencyKey: opts.idempotencyKey,
    body: {
      mode: "assisted",
      intent: "create",
      batchId: opts.batchId,
      batchIndex: opts.index,
      count: opts.size,
    },
    waitReason: waitCopy(opts.index, opts.size),
    batchId: opts.batchId,
    batchSize: opts.size,
    batchIndex: opts.index,
    predecessorJobId: opts.predecessorJobId ?? null,
  });
  return job;
}

export async function queueCreateBatch(
  sql: SqlLike,
  opts: {
    userId: string;
    count: number;
    idempotencyKey: string;
  },
): Promise<{ batch: BatchRow; job: JobRow }> {
  const requested = Math.floor(opts.count);
  if (requested < 1 || requested > CREATE_BATCH_MAX) {
    throw new OnboardingError("BATCH_SIZE_INVALID", "Pick between 1 and 5 accounts.", 400);
  }

  const open = await getOpenBatch(sql, opts.userId);
  if (open) {
    const job = open.current_job_id ? await getJob(sql, opts.userId, open.current_job_id) : null;
    if (job && Number(open.size) === requested) {
      return { batch: open, job };
    }
    throw new OnboardingError(
      "ACTIVE_BATCH_EXISTS",
      "A Reddit create queue is already running. Finish or cancel it first.",
      409,
    );
  }

  const active = await getActiveJob(sql, opts.userId);
  if (active) {
    throw new OnboardingError(
      "ACTIVE_JOB_EXISTS",
      "Finish or cancel the open Reddit setup before starting another.",
      409,
    );
  }

  const live = await countLiveAccounts(sql, opts.userId);
  const slots = remainingCreateSlots(live);
  if (slots < 1) {
    throw new OnboardingError("ACCOUNT_CAP", "This desk already has 8 Reddit accounts.", 409);
  }
  const size = Math.min(requested, slots);

  const id = crypto.randomUUID();
  const rows = await sql.query<BatchRow>(
    `insert into reddit_onboarding_batches (
       id, user_id, size, status, current_index
     ) values ($1, $2, $3, 'queued', 1)
     returning *`,
    [id, opts.userId, size],
  );
  const batch = rows[0];
  const job = await insertCreateJob(sql, {
    userId: opts.userId,
    batchId: id,
    size,
    index: 1,
    idempotencyKey: `${opts.idempotencyKey}:1`,
  });
  const updated = await sql.query<BatchRow>(
    `update reddit_onboarding_batches
        set current_job_id = $2, updated_at = now()
      where id = $1 and user_id = $3
      returning *`,
    [id, job.id, opts.userId],
  );
  await insertEvent(sql, {
    userId: opts.userId,
    jobId: job.id,
    type: "batch_queued",
    actorKind: "owner",
    actorId: opts.userId,
    jobVersion: Number(job.version),
    details: { size, batchId: id },
  });
  return { batch: updated[0] ?? batch, job };
}

async function recount(sql: SqlLike, batchId: string) {
  const rows = await sql.query<{ completed: number; failed: number; cancelled: number }>(
    `select
       count(*) filter (where status = 'completed')::int as completed,
       count(*) filter (where status in ('failed', 'blocked', 'expired'))::int as failed,
       count(*) filter (where status = 'cancelled')::int as cancelled
     from reddit_onboarding_jobs
     where batch_id = $1`,
    [batchId],
  );
  return {
    completed: Number(rows[0]?.completed ?? 0),
    failed: Number(rows[0]?.failed ?? 0),
    cancelled: Number(rows[0]?.cancelled ?? 0),
  };
}

export async function recordBatchJobFinished(
  sql: SqlLike,
  opts: {
    userId: string;
    job: JobRow;
    outcome: "completed" | "failed" | "cancelled";
    idempotencyKey?: string;
  },
): Promise<{ batch: BatchRow | null; nextJob: JobRow | null }> {
  const batchId = opts.job.batch_id;
  if (!batchId) return { batch: null, nextJob: null };
  const batch = await getBatch(sql, opts.userId, batchId);
  if (!batch) return { batch: null, nextJob: null };
  if (batch.status === "completed" || batch.status === "cancelled") {
    return { batch, nextJob: null };
  }

  const counts = await recount(sql, batchId);
  const size = Number(batch.size);

  if (opts.outcome === "cancelled" || opts.job.status === "cancelled") {
    const updated = await sql.query<BatchRow>(
      `update reddit_onboarding_batches set
         completed_count = $2,
         failed_count = $3,
         cancelled_count = $4,
         status = 'cancelled',
         updated_at = now()
       where id = $1
       returning *`,
      [batchId, counts.completed, counts.failed, Math.max(counts.cancelled, size - counts.completed - counts.failed)],
    );
    return { batch: updated[0] ?? batch, nextJob: null };
  }

  const done = counts.completed + counts.failed;
  if (done >= size) {
    const updated = await sql.query<BatchRow>(
      `update reddit_onboarding_batches set
         completed_count = $2,
         failed_count = $3,
         cancelled_count = $4,
         status = 'completed',
         current_job_id = $5,
         current_index = $6,
         updated_at = now()
       where id = $1
       returning *`,
      [batchId, counts.completed, counts.failed, counts.cancelled, opts.job.id, Number(opts.job.batch_index ?? size)],
    );
    return { batch: updated[0] ?? batch, nextJob: null };
  }

  const nextIndex = Number(opts.job.batch_index ?? 1) + 1;
  const live = await countLiveAccounts(sql, opts.userId);
  if (remainingCreateSlots(live) < 1) {
    const updated = await sql.query<BatchRow>(
      `update reddit_onboarding_batches set
         completed_count = $2,
         failed_count = $3,
         status = 'completed',
         current_job_id = $4,
         updated_at = now()
       where id = $1
       returning *`,
      [batchId, counts.completed, counts.failed, opts.job.id],
    );
    return { batch: updated[0] ?? batch, nextJob: null };
  }

  const nextJob = await insertCreateJob(sql, {
    userId: opts.userId,
    batchId,
    size,
    index: nextIndex,
    predecessorJobId: opts.job.id,
    idempotencyKey: opts.idempotencyKey || `${batchId}:${nextIndex}`,
  });
  const updated = await sql.query<BatchRow>(
    `update reddit_onboarding_batches set
       completed_count = $2,
       failed_count = $3,
       cancelled_count = $4,
       status = 'running',
       current_job_id = $5,
       current_index = $6,
       updated_at = now()
     where id = $1
     returning *`,
    [batchId, counts.completed, counts.failed, counts.cancelled, nextJob.id, nextIndex],
  );
  await insertEvent(sql, {
    userId: opts.userId,
    jobId: nextJob.id,
    type: "batch_advanced",
    actorKind: "system",
    jobVersion: Number(nextJob.version),
    details: { batchId, index: nextIndex, size },
  });
  return { batch: updated[0] ?? batch, nextJob };
}

export async function markBatchRunning(
  sql: SqlLike,
  userId: string,
  batchId: string,
): Promise<BatchRow | null> {
  const rows = await sql.query<BatchRow>(
    `update reddit_onboarding_batches
        set status = case when status in ('cancelled', 'completed') then status else 'running' end,
            updated_at = now()
      where id = $1 and user_id = $2
      returning *`,
    [batchId, userId],
  );
  return rows[0] ?? null;
}

export async function recoverOpenBatch(
  sql: SqlLike,
  userId: string,
): Promise<{ batch: BatchRow; job: JobRow | null } | null> {
  const batch = await getOpenBatch(sql, userId);
  if (!batch) return null;
  const current = batch.current_job_id ? await getJob(sql, userId, batch.current_job_id) : null;
  if (current && !current.finished_at) return { batch, job: current };
  if (current && current.finished_at) {
    const outcome =
      current.status === "cancelled"
        ? "cancelled"
        : current.status === "completed"
          ? "completed"
          : "failed";
    const advanced = await recordBatchJobFinished(sql, { userId, job: current, outcome });
    return { batch: advanced.batch ?? batch, job: advanced.nextJob };
  }
  return { batch, job: current };
}

export async function cancelOpenBatch(sql: SqlLike, userId: string, job: JobRow): Promise<BatchRow | null> {
  if (!job.batch_id) return getOpenBatch(sql, userId);
  const advanced = await recordBatchJobFinished(sql, { userId, job, outcome: "cancelled" });
  return advanced.batch;
}
