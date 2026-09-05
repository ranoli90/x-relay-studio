import { encryptV2 } from "./vault.ts";
import type { SqlLike } from "./sql.ts";
import type { BrowserProvider } from "./provider.ts";
import { enqueueCleanup, insertEvent } from "./store.ts";

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

export async function claimCleanup(sql: SqlLike, workerId: string) {
  const rows = await sql.query<{
    id: string;
    user_id: string;
    job_id: string | null;
    account_id: string | null;
    kind: string;
    target_reference: string;
    encrypted_revocation_material: string | null;
    attempt: number;
    status: string;
  }>(
    `update reddit_cleanup_tasks
        set status = 'leased',
            lease_owner = $1,
            lease_until = now() + interval '60 seconds',
            attempt = attempt + 1
      where id = (
        select id from reddit_cleanup_tasks
         where status in ('queued', 'leased')
           and available_at <= now()
           and (lease_until is null or lease_until <= now() or status = 'queued')
         order by available_at
         limit 1
      )
      returning *`,
    [workerId],
  );
  return rows[0] ?? null;
}

export async function runCleanupTask(
  sql: SqlLike,
  task: NonNullable<Awaited<ReturnType<typeof claimCleanup>>>,
  provider: BrowserProvider,
  revokeOauth?: (material: string) => Promise<{ ok: boolean }>,
) {
  try {
    if (task.kind === "release_session") {
      const result = await provider.requestRelease(task.target_reference);
      if (!result.ended) {
        await retryLater(sql, task.id, "SESSION_STILL_RUNNING");
        return { pending: true };
      }
    } else if (task.kind === "delete_context") {
      const deleted = await provider.deleteContext(task.target_reference);
      if (!deleted.deleted) {
        await retryLater(sql, task.id, "CONTEXT_DELETE_PENDING");
        return { pending: true };
      }
    } else if (task.kind === "revoke_oauth") {
      if (!task.encrypted_revocation_material) {
        await finish(sql, task.id, "NO_MATERIAL");
        return { pending: false };
      }
      if (!revokeOauth) {
        await retryLater(sql, task.id, "REVOKER_MISSING");
        return { pending: true };
      }
      const result = await revokeOauth(task.encrypted_revocation_material);
      if (!result.ok) {
        await retryLater(sql, task.id, "REVOKE_HTTP_FAILED");
        return { pending: true };
      }
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
      await sql.query(
        `update reddit_accounts
            set cleanup_pending = false, updated_at = now()
          where user_id = $1 and id = $2`,
        [task.user_id, task.account_id],
      );
    }
    await finish(sql, task.id, null);
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
    await retryLater(sql, task.id, "CLEANUP_ERROR");
    return { pending: true };
  }
}

async function retryLater(sql: SqlLike, id: string, code: string) {
  await sql.query(
    `update reddit_cleanup_tasks
        set status = 'queued',
            available_at = now() + interval '2 minutes',
            last_error_code = $2,
            lease_owner = null,
            lease_until = null
      where id = $1`,
    [id, code],
  );
}

async function finish(sql: SqlLike, id: string, error: string | null) {
  await sql.query(
    `update reddit_cleanup_tasks
        set status = $2,
            completed_at = now(),
            last_error_code = $3,
            lease_owner = null,
            lease_until = null
      where id = $1`,
    [id, error ? "failed" : "completed", error],
  );
}

export async function expireRetainedProfiles(sql: SqlLike) {
  const expired = await sql.query<{ id: string; user_id: string; provider_context_id: string | null }>(
    `update reddit_browser_profiles
        set status = 'deleting', delete_requested_at = now(), updated_at = now()
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
