type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/** After this many claims, a failure is terminal `dead` (inspectable last_error). */
export const MAX_JOB_ATTEMPTS = 8;

export type ClaimedJob = {
  id: string;
  user_id: string;
  thread_id: string | null;
  kind: string;
  claim_token: string;
};

/**
 * Claim due rows with a worker token. Expired `claimed` rows are reclaimable;
 * `dead` / `succeeded` are not. Production uses `for update skip locked`.
 */
export async function claimDueJobs(
  sql: Sql,
  token: string,
  opts?: { userId?: string; limit?: number },
): Promise<ClaimedJob[]> {
  const limit = opts?.limit ?? 20;
  if (opts?.userId) {
    return sql.query<ClaimedJob>(
      `update agent_jobs
          set claim_token = $1,
              claim_until = now() + interval '2 minutes',
              status = 'claimed',
              attempt_count = coalesce(attempt_count, 0) + 1
        where id in (
          select id from agent_jobs
           where done_at is null
             and run_at <= now()
             and (claim_until is null or claim_until <= now())
             and coalesce(status, 'pending') not in ('dead', 'succeeded')
             and user_id = $2
           order by run_at
           for update skip locked
           limit $3
        )
        returning id, user_id, thread_id, kind, claim_token`,
      [token, opts.userId, limit],
    );
  }
  return sql.query<ClaimedJob>(
    `update agent_jobs
        set claim_token = $1,
            claim_until = now() + interval '2 minutes',
            status = 'claimed',
            attempt_count = coalesce(attempt_count, 0) + 1
      where id in (
        select id from agent_jobs
         where done_at is null
           and run_at <= now()
           and (claim_until is null or claim_until <= now())
           and coalesce(status, 'pending') not in ('dead', 'succeeded')
         order by run_at
         for update skip locked
         limit $2
      )
      returning id, user_id, thread_id, kind, claim_token`,
    [token, limit],
  );
}

export async function finalizeJob(
  sql: Sql,
  jobId: string,
  token: string,
  outcome: { ok: true } | { ok: false; error: string },
): Promise<boolean> {
  if (outcome.ok) {
    const rows = await sql.query<{ id: string }>(
      `update agent_jobs
          set done_at = now(), status = 'succeeded', claim_until = null
        where id = $1
          and claim_token = $2
          and done_at is null
          and status = 'claimed'
        returning id`,
      [jobId, token],
    );
    return Boolean(rows[0]);
  }
  const rows = await sql.query<{ id: string }>(
    `update agent_jobs
        set status = case
              when coalesce(attempt_count, 0) >= $4 then 'dead'
              else 'retry_wait'
            end,
            last_error = $3,
            run_at = case
              when coalesce(attempt_count, 0) >= $4 then run_at
              else now() + interval '2 minutes'
            end,
            claim_until = null
      where id = $1
        and claim_token = $2
        and done_at is null
        and status = 'claimed'
      returning id`,
    [jobId, token, outcome.error.slice(0, 240), MAX_JOB_ATTEMPTS],
  );
  return Boolean(rows[0]);
}
