import { newId } from "../../agent/ids.ts";
import { redditContextRetentionDays, redditWorkflowVersion, environmentId } from "./config.ts";
import { OnboardingError, type ProfileStatus } from "./types.ts";
import type { SqlLike } from "./sql.ts";
import { enqueueCleanup } from "./store.ts";
import { withSqlTransaction } from "./sql.ts";

export const RETENTION_STATUSES = [
  "requested",
  "temporary",
  "retained",
  "needs_reauth",
  "expired",
  "delete_pending",
  "deleted",
  "failed",
] as const;

export type RetentionStatus = (typeof RETENTION_STATUSES)[number];

export type ProfileRow = {
  id: string;
  user_id: string;
  account_id: string | null;
  origin_job_id: string;
  provider: string;
  provider_project_id: string | null;
  provider_context_id: string | null;
  environment_id: string | null;
  region: string | null;
  status: string;
  generation: number;
  retention_consent_at: string | Date | null;
  expires_at: string | Date | null;
  last_used_at: string | Date | null;
  last_identity_verified_at: string | Date | null;
  last_verified_reddit_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  delete_requested_at: string | Date | null;
  deleted_at: string | Date | null;
  retention_requested: boolean;
  retention_status: string;
  retained_at: string | Date | null;
  consent_receipt_id: string | null;
  workflow_version: string | null;
  session_generation: number;
  lease_owner: string | null;
  lease_generation: number;
  lease_until: string | Date | null;
  last_verified_username: string | null;
  reddit_id: string | null;
  deletion_state: string;
  deletion_confirmed_at: string | Date | null;
  failure_code: string | null;
};

export type ProfilePublic = {
  id: string;
  accountId: string | null;
  provider: string;
  providerProjectId: string | null;
  environmentId: string | null;
  workflowVersion: string | null;
  retentionRequested: boolean;
  retentionStatus: string;
  status: string;
  retainedAt: string | null;
  expiresAt: string | null;
  lastVerifiedUsername: string | null;
  redditId: string | null;
  deletionState: string;
  leaseOwner: string | null;
  leaseUntil: string | null;
};

export type ProfileBinding = {
  accountId?: string | null;
  provider?: string | null;
  providerProjectId?: string | null;
  environmentId?: string | null;
  workflowVersion?: string | null;
  redditId?: string | null;
  username?: string | null;
};

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export function isSignInRetained(profile: { retentionStatus: string; retentionRequested?: boolean }): boolean {
  return profile.retentionStatus === "retained";
}

export function retentionLabel(status: string): string {
  switch (status) {
    case "requested":
      return "Retention requested — not saved until persistence is confirmed.";
    case "temporary":
      return "Temporary browser state. Not retained.";
    case "retained":
      return "Retained sign-in.";
    case "needs_reauth":
      return "Needs the same-account sign-in again.";
    case "expired":
      return "Retention expired.";
    case "delete_pending":
      return "Deletion requested, waiting for confirmation.";
    case "deleted":
      return "Retained sign-in deleted.";
    case "failed":
      return "Retention failed.";
    default:
      return status;
  }
}

export function toPublicProfile(row: ProfileRow): ProfilePublic {
  return {
    id: row.id,
    accountId: row.account_id,
    provider: row.provider,
    providerProjectId: row.provider_project_id,
    environmentId: row.environment_id,
    workflowVersion: row.workflow_version,
    retentionRequested: Boolean(row.retention_requested),
    retentionStatus: row.retention_status,
    status: row.status,
    retainedAt: iso(row.retained_at),
    expiresAt: iso(row.expires_at),
    lastVerifiedUsername: row.last_verified_username,
    redditId: row.reddit_id,
    deletionState: row.deletion_state,
    leaseOwner: row.lease_owner,
    leaseUntil: iso(row.lease_until),
  };
}

async function getProfileRow(sql: SqlLike, userId: string, profileId: string): Promise<ProfileRow> {
  const rows = await sql.query<ProfileRow>(
    `select * from reddit_browser_profiles where id = $1 and user_id = $2 limit 1`,
    [profileId, userId],
  );
  if (!rows[0]) throw new OnboardingError("PROFILE_NOT_FOUND", "No browser profile was found.");
  return rows[0];
}

export async function createBrowserProfile(
  sql: SqlLike,
  opts: {
    userId: string;
    originJobId: string;
    provider: string;
    accountId?: string | null;
    providerProjectId?: string | null;
    providerContextId?: string | null;
    environmentId?: string | null;
    workflowVersion?: string | null;
    redditId?: string | null;
    lastVerifiedUsername?: string | null;
    status?: ProfileStatus;
  },
): Promise<ProfilePublic> {
  const rows = await sql.query<ProfileRow>(
    `insert into reddit_browser_profiles (
       id, user_id, account_id, origin_job_id, provider, provider_project_id,
       provider_context_id, environment_id, status, workflow_version,
       retention_requested, retention_status, last_verified_username, reddit_id,
       last_verified_reddit_id, session_generation, lease_generation, deletion_state
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,'temporary',$11,$12,$12,0,0,'none'
     ) returning *`,
    [
      newId("rbp"),
      opts.userId,
      opts.accountId ?? null,
      opts.originJobId,
      opts.provider,
      opts.providerProjectId ?? null,
      opts.providerContextId ?? null,
      opts.environmentId ?? environmentId(),
      opts.status ?? "temporary",
      opts.workflowVersion ?? redditWorkflowVersion(),
      opts.lastVerifiedUsername ?? null,
      opts.redditId ?? null,
    ],
  );
  return toPublicProfile(rows[0]);
}

export async function getProfileForAccount(
  sql: SqlLike,
  userId: string,
  accountId: string,
): Promise<ProfilePublic | null> {
  const rows = await sql.query<ProfileRow>(
    `select * from reddit_browser_profiles
      where user_id = $1 and account_id = $2 and deleted_at is null
      order by updated_at desc
      limit 1`,
    [userId, accountId],
  );
  return rows[0] ? toPublicProfile(rows[0]) : null;
}

export async function bindProfileToAccount(
  sql: SqlLike,
  opts: {
    userId: string;
    profileId: string;
    accountId: string;
    redditId?: string | null;
    username?: string | null;
  },
): Promise<ProfilePublic> {
  const rows = await sql.query<ProfileRow>(
    `update reddit_browser_profiles
        set account_id = $3,
            reddit_id = coalesce($4, reddit_id),
            last_verified_reddit_id = coalesce($4, last_verified_reddit_id),
            last_verified_username = coalesce($5, last_verified_username),
            last_identity_verified_at = now(),
            updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning *`,
    [opts.profileId, opts.userId, opts.accountId, opts.redditId ?? null, opts.username ?? null],
  );
  if (!rows[0]) throw new OnboardingError("PROFILE_NOT_FOUND", "No browser profile was found.");
  return toPublicProfile(rows[0]);
}

export async function requestRetention(
  sql: SqlLike,
  opts: { userId: string; profileId: string; consentReceiptId?: string | null },
): Promise<ProfilePublic> {
  const rows = await sql.query<ProfileRow>(
    `update reddit_browser_profiles
        set retention_requested = true,
            retention_status = case
              when retention_status = 'retained' then retention_status
              else 'requested'
            end,
            retention_consent_at = coalesce(retention_consent_at, now()),
            consent_receipt_id = coalesce($3, consent_receipt_id),
            updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning *`,
    [opts.profileId, opts.userId, opts.consentReceiptId ?? null],
  );
  if (!rows[0]) throw new OnboardingError("PROFILE_NOT_FOUND", "No browser profile was found.");
  return toPublicProfile(rows[0]);
}

export async function confirmPersisted(
  sql: SqlLike,
  opts: { userId: string; profileId: string; expiresAt?: string | Date | null },
): Promise<ProfilePublic> {
  const days = redditContextRetentionDays();
  const expires =
    opts.expiresAt instanceof Date
      ? opts.expiresAt.toISOString()
      : opts.expiresAt ?? new Date(Date.now() + days * 86_400_000).toISOString();
  const rows = await sql.query<ProfileRow>(
    `update reddit_browser_profiles
        set retention_status = 'retained',
            status = 'retained',
            retained_at = now(),
            expires_at = $3,
            updated_at = now()
      where id = $1 and user_id = $2
        and retention_requested = true
        and deletion_state = 'none'
        and deleted_at is null
      returning *`,
    [opts.profileId, opts.userId, expires],
  );
  if (!rows[0]) {
    throw new OnboardingError(
      "RETENTION_NOT_REQUESTED",
      "Persistence can only be confirmed for a profile the owner opted to retain.",
    );
  }
  return toPublicProfile(rows[0]);
}

function cannotReopen(row: ProfileRow): string | null {
  if (row.deleted_at || row.retention_status === "deleted" || row.status === "deleted") {
    return "This retained sign-in was deleted.";
  }
  if (
    row.deletion_state !== "none" ||
    row.status === "deleting" ||
    row.retention_status === "delete_pending"
  ) {
    return "This profile is being deleted and cannot be reopened.";
  }
  if (!row.account_id) {
    return "This profile is not bound to an owned account.";
  }
  if (row.status === "quarantined") {
    return "This account is paused because of a restriction. It will not be replaced.";
  }
  if (row.retention_status === "failed") {
    return "This retained sign-in failed and cannot be reopened.";
  }
  if (row.retention_status !== "retained" && row.retention_status !== "needs_reauth") {
    return "There is no confirmed retained sign-in to reopen.";
  }
  return null;
}

function mismatch(row: ProfileRow, expected?: ProfileBinding): string | null {
  if (!expected) return null;
  if (expected.accountId && expected.accountId !== row.account_id) return "account";
  if (expected.provider && expected.provider !== row.provider) return "provider";
  if (expected.providerProjectId && expected.providerProjectId !== row.provider_project_id) return "project";
  if (expected.environmentId && expected.environmentId !== row.environment_id) return "environment";
  if (expected.workflowVersion && expected.workflowVersion !== row.workflow_version) return "workflow";
  if (expected.redditId && expected.redditId !== (row.reddit_id || row.last_verified_reddit_id)) return "identity";
  if (
    expected.username &&
    row.last_verified_username &&
    expected.username.toLowerCase() !== row.last_verified_username.toLowerCase()
  ) {
    return "identity";
  }
  return null;
}

export async function reopenProfile(
  sql: SqlLike,
  opts: {
    userId: string;
    profileId: string;
    leaseOwner: string;
    expected?: ProfileBinding;
    observedIdentity?: { username?: string; redditId?: string };
    authExpired?: boolean;
    restricted?: boolean;
    leaseSeconds?: number;
  },
): Promise<{ profile: ProfilePublic; leaseGeneration: number }> {
  return withSqlTransaction(sql, async (tx) => {
    const row = await getProfileRow(tx, opts.userId, opts.profileId);
    const blocked = cannotReopen(row);
    if (blocked) throw new OnboardingError("PROFILE_CANNOT_REOPEN", blocked);

    if (row.expires_at && new Date(iso(row.expires_at) || 0).getTime() < Date.now()) {
      await tx.query(
        `update reddit_browser_profiles
            set retention_status = 'expired', updated_at = now()
          where id = $1 and user_id = $2`,
        [row.id, opts.userId],
      );
      throw new OnboardingError(
        "PROFILE_EXPIRED",
        "This retained sign-in has expired. Sign in again with the same Reddit account.",
      );
    }

    if (opts.restricted) {
      await tx.query(
        `update reddit_browser_profiles
            set status = 'quarantined', updated_at = now()
          where id = $1 and user_id = $2`,
        [row.id, opts.userId],
      );
      throw new OnboardingError(
        "ACCOUNT_RESTRICTED",
        "This account is paused because of a restriction. A replacement account will not be created.",
      );
    }

    if (opts.authExpired) {
      await tx.query(
        `update reddit_browser_profiles
            set retention_status = 'needs_reauth',
                lease_owner = null,
                lease_until = null,
                updated_at = now()
          where id = $1 and user_id = $2`,
        [row.id, opts.userId],
      );
      throw new OnboardingError(
        "NEEDS_REAUTH",
        "The saved sign-in expired. Sign in again with the same Reddit account. A new account will not be created.",
      );
    }

    const field = mismatch(row, opts.expected);
    if (field) {
      throw new OnboardingError(
        "PROFILE_MISMATCH",
        "This retained sign-in does not match the owner, account, provider, project, environment, or workflow.",
      );
    }

    if (opts.observedIdentity) {
      const expectedUser = row.last_verified_username;
      const expectedId = row.reddit_id || row.last_verified_reddit_id;
      if (
        (opts.observedIdentity.username &&
          expectedUser &&
          opts.observedIdentity.username.toLowerCase() !== expectedUser.toLowerCase()) ||
        (opts.observedIdentity.redditId && expectedId && opts.observedIdentity.redditId !== expectedId)
      ) {
        throw new OnboardingError(
          "IDENTITY_MISMATCH",
          "The signed-in Reddit identity does not match this profile. Access is stopped.",
        );
      }
    }

    const seconds = Math.max(30, Math.min(opts.leaseSeconds ?? 300, 900));
    const claimed = await tx.query<ProfileRow>(
      `update reddit_browser_profiles
          set lease_owner = $3,
              lease_generation = lease_generation + 1,
              lease_until = now() + ($4 || ' seconds')::interval,
              last_used_at = now(),
              session_generation = session_generation + 1,
              updated_at = now()
        where id = $1 and user_id = $2
          and deletion_state = 'none'
          and deleted_at is null
          and status not in ('deleting', 'deleted', 'quarantined')
          and (lease_until is null or lease_until <= now())
        returning *`,
      [row.id, opts.userId, opts.leaseOwner, String(seconds)],
    );
    if (!claimed[0]) {
      throw new OnboardingError("PROFILE_LEASE_HELD", "Another session already holds this retained sign-in.");
    }
    return { profile: toPublicProfile(claimed[0]), leaseGeneration: Number(claimed[0].lease_generation) };
  });
}

export async function releaseProfileLease(
  sql: SqlLike,
  opts: { userId: string; profileId?: string; accountId?: string; leaseOwner?: string },
): Promise<{ released: boolean; profile: ProfilePublic | null }> {
  const rows = opts.profileId
    ? await sql.query<ProfileRow>(
        `update reddit_browser_profiles
            set lease_owner = null,
                lease_until = null,
                updated_at = now()
          where id = $1 and user_id = $2
            and ($3::text is null or lease_owner = $3)
          returning *`,
        [opts.profileId, opts.userId, opts.leaseOwner ?? null],
      )
    : await sql.query<ProfileRow>(
        `update reddit_browser_profiles
            set lease_owner = null,
                lease_until = null,
                updated_at = now()
          where user_id = $1 and account_id = $2 and deleted_at is null
            and ($3::text is null or lease_owner = $3)
          returning *`,
        [opts.userId, opts.accountId ?? null, opts.leaseOwner ?? null],
      );
  return { released: Boolean(rows[0]), profile: rows[0] ? toPublicProfile(rows[0]) : null };
}

export async function markNeedsReauth(
  sql: SqlLike,
  opts: { userId: string; profileId: string },
): Promise<ProfilePublic> {
  const rows = await sql.query<ProfileRow>(
    `update reddit_browser_profiles
        set retention_status = 'needs_reauth',
            lease_owner = null,
            lease_until = null,
            updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning *`,
    [opts.profileId, opts.userId],
  );
  if (!rows[0]) throw new OnboardingError("PROFILE_NOT_FOUND", "No browser profile was found.");
  return toPublicProfile(rows[0]);
}

export async function quarantineRestricted(
  sql: SqlLike,
  opts: { userId: string; profileId: string },
): Promise<ProfilePublic> {
  const rows = await sql.query<ProfileRow>(
    `update reddit_browser_profiles
        set status = 'quarantined',
            lease_owner = null,
            lease_until = null,
            updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning *`,
    [opts.profileId, opts.userId],
  );
  if (!rows[0]) throw new OnboardingError("PROFILE_NOT_FOUND", "No browser profile was found.");
  return toPublicProfile(rows[0]);
}

export async function requestDeletion(
  sql: SqlLike,
  opts: { userId: string; profileId: string },
): Promise<ProfilePublic> {
  const rows = await sql.query<ProfileRow>(
    `update reddit_browser_profiles
        set retention_status = 'delete_pending',
            status = 'deleting',
            deletion_state = 'requested',
            delete_requested_at = now(),
            lease_owner = null,
            lease_until = null,
            updated_at = now()
      where id = $1 and user_id = $2 and deleted_at is null
      returning *`,
    [opts.profileId, opts.userId],
  );
  if (!rows[0]) throw new OnboardingError("PROFILE_NOT_FOUND", "No browser profile was found.");
  return toPublicProfile(rows[0]);
}

export async function confirmDeletion(
  sql: SqlLike,
  opts: { userId: string; profileId: string },
): Promise<ProfilePublic> {
  const row = await getProfileRow(sql, opts.userId, opts.profileId);
  if (row.deletion_state !== "requested" && row.retention_status !== "delete_pending") {
    throw new OnboardingError("DELETION_NOT_REQUESTED", "Deletion must be requested before it can be confirmed.");
  }
  if (row.provider_context_id) {
    await enqueueCleanup(sql, {
      userId: opts.userId,
      kind: "delete_context",
      target: row.provider_context_id,
    });
  }
  const rows = await sql.query<ProfileRow>(
    `update reddit_browser_profiles
        set retention_status = 'deleted',
            status = 'deleted',
            deletion_state = 'confirmed',
            deletion_confirmed_at = now(),
            deleted_at = now(),
            updated_at = now()
      where id = $1 and user_id = $2
      returning *`,
    [opts.profileId, opts.userId],
  );
  return toPublicProfile(rows[0]);
}
