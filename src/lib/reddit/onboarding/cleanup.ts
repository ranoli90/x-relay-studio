import { decryptV2, encryptV2 } from "./vault.ts";
import type { SqlLike } from "./sql.ts";
import { withSqlTransaction } from "./sql.ts";
import type { BrowserProvider } from "./provider.ts";
import { enqueueCleanup, insertEvent } from "./store.ts";
import { OnboardingError } from "./types.ts";

export async function queueDisconnectCleanup(
  sql: SqlLike,
  opts: {
    userId: string;
    accountId: string;
    jobId?: string;
    refreshToken?: string;
    sessionId?: string | null;
    contextId?: string | null;
  },
) {
  if (opts.refreshToken) {
    const material = encryptV2(opts.refreshToken, {
      userId: opts.userId,
      recordId: opts.accountId,
      purpose: "oauth_revocation_material",
    });
    await enqueueCleanup(sql, {
      userId: opts.userId,
      accountId: opts.accountId,
      jobId: opts.jobId,
      kind: "revoke_oauth",
      target: `oauth:${opts.accountId}`,
      encryptedMaterial: material,
    });
  }
  if (opts.sessionId) {
    await enqueueCleanup(sql, {
      userId: opts.userId,
      accountId: opts.accountId,
      jobId: opts.jobId,
      kind: "release_session",
      target: opts.sessionId,
    });
  }
  if (opts.contextId) {
    await enqueueCleanup(sql, {
      userId: opts.userId,
      accountId: opts.accountId,
      jobId: opts.jobId,
      kind: "delete_context",
      target: opts.contextId,
    });
  }
  await enqueueCleanup(sql, {
    userId: opts.userId,
    accountId: opts.accountId,
    jobId: opts.jobId,
    kind: "purge_temporary_secret",
    target: `secrets:${opts.accountId}`,
  });
  await enqueueCleanup(sql, {
    userId: opts.userId,
    accountId: opts.accountId,
    jobId: opts.jobId,
    kind: "confirm_local_disconnect",
    target: `account:${opts.accountId}`,
  });
}

export type CleanupTask = {
  id: string;
  user_id: string;
  job_id: string | null;
  account_id: string | null;
  kind: string;
  target_reference: string;
  encrypted_revocation_material: string | null;
  attempt: number;
  status: string;
  lease_owner: string | null;
  lease_generation: number;
};

export async function claimCleanup(sql: SqlLike, workerId: string): Promise<CleanupTask | null> {
  const rows = await sql.query<CleanupTask>(
    `update reddit_cleanup_tasks
        set status = 'leased',
            lease_owner = $1,
            lease_generation = lease_generation + 1,
            lease_until = now() + interval '60 seconds',
            attempt = attempt + 1
      where id = (
        select id from reddit_cleanup_tasks
         where status in ('queued', 'leased')
           and available_at <= now()
           and (lease_until is null or lease_until <= now() or status = 'queued')
         order by case when kind = 'confirm_local_disconnect' then 1 else 0 end, available_at
         for update skip locked
         limit 1
      )
      returning *`,
    [workerId],
  );
  return rows[0] ?? null;
}

export type OauthRevoker = (material: string, meta: { userId: string; accountId: string | null }) => Promise<{ ok: boolean }>;

export async function runCleanupTask(
  sql: SqlLike,
  task: CleanupTask,
  provider: BrowserProvider,
  revokeOauth?: OauthRevoker,
) {
  const fence = {
    id: task.id,
    owner: task.lease_owner,
    generation: Number(task.lease_generation),
  };
  try {
    if (task.kind === "release_session") {
      const result = await provider.requestRelease(task.target_reference);
      if (!result.ended) {
        await retryLater(sql, fence, "SESSION_STILL_RUNNING");
        return { pending: true };
      }
    } else if (task.kind === "delete_context") {
      const deleted = await provider.deleteContext(task.target_reference);
      if (!deleted.deleted) {
        await retryLater(sql, fence, "CONTEXT_DELETE_PENDING");
        return { pending: true };
      }
    } else if (task.kind === "revoke_oauth") {
      if (!task.encrypted_revocation_material) {
        await finish(sql, fence, "NO_MATERIAL");
        return { pending: false };
      }
      if (!revokeOauth) {
        await retryLater(sql, fence, "REVOKER_MISSING");
        return { pending: true };
      }
      const result = await revokeOauth(task.encrypted_revocation_material, {
        userId: task.user_id,
        accountId: task.account_id,
      });
      if (!result.ok) {
        await retryLater(sql, fence, "REVOKE_HTTP_FAILED");
        return { pending: true };
      }
      await sql.query(
        `update reddit_cleanup_tasks
            set encrypted_revocation_material = null
          where id = $1
            and lease_owner = $2
            and lease_generation = $3`,
        [fence.id, fence.owner, fence.generation],
      );
    } else if (task.kind === "purge_temporary_secret" || task.kind === "purge_retained_secret") {
      await sql.query(
        `update reddit_secret_entries
            set deleted_at = now(), ciphertext = 'purged'
          where user_id = $1
            and (account_id = $2 or job_id = $3)
            and deleted_at is null
            and (
              $4 = 'purge_temporary_secret' and purpose in ('signup_email', 'temporary_signup_password')
              or $4 = 'purge_retained_secret' and purpose = 'retained_reddit_password'
              or expires_at < now()
            )`,
        [task.user_id, task.account_id, task.job_id, task.kind],
      );
    } else if (task.kind === "confirm_local_disconnect") {
      const children = await sql.query<{ n: number; failed: number }>(
        `select
           count(*) filter (where status not in ('completed'))::int as n,
           count(*) filter (where status = 'failed')::int as failed
           from reddit_cleanup_tasks
          where user_id = $1
            and account_id = $2
            and kind <> 'confirm_local_disconnect'
            and required is not false`,
        [task.user_id, task.account_id],
      );
      const pending = Number(children[0]?.n ?? 0);
      const failed = Number(children[0]?.failed ?? 0);
      if (pending > 0) {
        await retryLater(sql, fence, failed ? "CLEANUP_CHILD_FAILED" : "SUMMARY_CHILDREN_PENDING");
        return { pending: true };
      }
      await sql.query(
        `update reddit_accounts
            set cleanup_pending = false, updated_at = now()
          where user_id = $1 and id = $2`,
        [task.user_id, task.account_id],
      );
    }
    await finish(sql, fence, null);
    if (task.job_id) {
      await insertEvent(sql, {
        userId: task.user_id,
        jobId: task.job_id,
        type: "cleanup_completed",
        actorKind: "worker",
        jobVersion: 0,
        details: { kind: task.kind },
      });
    }
    return { pending: false };
  } catch {
    await retryLater(sql, fence, "CLEANUP_ERROR");
    return { pending: true };
  }
}

async function retryLater(
  sql: SqlLike,
  fence: { id: string; owner: string | null; generation: number },
  code: string,
) {
  const backoff = Math.min(30, 2 ** Math.min(6, fence.generation)) ;
  await sql.query(
    `update reddit_cleanup_tasks
        set status = 'queued',
            available_at = now() + ($4::int * interval '1 minute'),
            last_error_code = $5,
            lease_owner = null,
            lease_until = null
      where id = $1
        and coalesce(lease_owner, '') = coalesce($2, '')
        and lease_generation = $3`,
    [fence.id, fence.owner, fence.generation, backoff, code],
  );
}

async function finish(
  sql: SqlLike,
  fence: { id: string; owner: string | null; generation: number },
  error: string | null,
) {
  const rows = await sql.query(
    `update reddit_cleanup_tasks
        set status = $4,
            completed_at = now(),
            last_error_code = $5,
            lease_owner = null,
            lease_until = null
      where id = $1
        and coalesce(lease_owner, '') = coalesce($2, '')
        and lease_generation = $3
      returning id`,
    [fence.id, fence.owner, fence.generation, error ? "failed" : "completed", error],
  );
  if (!rows[0] && error === null) {
    throw new OnboardingError("STALE_LEASE", "Stale cleanup worker cannot finish.", 409);
  }
}

export async function expireRetainedProfiles(sql: SqlLike) {
  const expired = await sql.query<{ id: string; user_id: string; provider_context_id: string | null }>(
    `update reddit_browser_profiles
        set status = 'deleting',
            retention_status = 'delete_pending',
            delete_requested_at = now(),
            updated_at = now()
      where deleted_at is null
        and expires_at is not null
        and expires_at < now()
        and status in ('retained', 'temporary', 'needs_reauth')
      returning id, user_id, provider_context_id`,
  );
  for (const row of expired) {
    if (row.provider_context_id) {
      await enqueueCleanup(sql, {
        userId: row.user_id,
        kind: "delete_context",
        target: row.provider_context_id,
      });
    }
  }
  return expired.length;
}

export async function disableAndQueueDisconnect(
  sql: SqlLike,
  opts: {
    userId: string;
    accountId: string;
    refreshToken?: string;
    sessionId?: string | null;
    contextId?: string | null;
    jobId?: string;
  },
) {
  return withSqlTransaction(sql, async (tx) => {
    const rows = await tx.query(
      `update reddit_accounts
          set disabled_at = coalesce(disabled_at, now()),
              disconnected_at = coalesce(disconnected_at, now()),
              connection_state = 'disabled',
              cleanup_pending = true,
              health_ok = false,
              updated_at = now()
        where user_id = $1 and id = $2
        returning id`,
      [opts.userId, opts.accountId],
    );
    if (!rows[0]) return null;
    await queueDisconnectCleanup(tx, opts);
    return rows[0];
  });
}

export function decryptRevocationMaterial(
  material: string,
  userId: string,
  accountId: string,
): string {
  return decryptV2(material, {
    userId,
    recordId: accountId,
    purpose: "oauth_revocation_material",
  });
}
