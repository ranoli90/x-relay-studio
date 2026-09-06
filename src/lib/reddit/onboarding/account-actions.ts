import { OnboardingError, type DraftPublic, type EmailBindingPublic, type ReadinessReport } from "./types.ts";
import type { SqlLike } from "./sql.ts";
import { queueDisconnectCleanup } from "./cleanup.ts";
import {
  createEmailBinding,
  deleteEmailBinding,
  listEmailBindings,
  markDestinationVerified,
  type CreateEmailBindingInput,
} from "./email.ts";
import { generateDraft, listDrafts, type GenerateDraftInput, type GenerateDraftOptions } from "./drafts.ts";
import {
  getReadiness,
  observeReadiness,
  replacementAccountForbidden,
  shouldPauseForRestriction,
  type ReadinessCheckKey,
  type CheckObservation,
} from "./readiness.ts";
import {
  confirmDeletion,
  getProfileForAccount,
  isSignInRetained,
  markNeedsReauth,
  quarantineRestricted,
  releaseProfileLease,
  reopenProfile,
  requestDeletion,
  type ProfileBinding,
  type ProfilePublic,
} from "./retention.ts";

export type AccountActionsSnapshot = {
  accountId: string;
  readiness: ReadinessReport;
  emailBindings: EmailBindingPublic[];
  retainedProfile: ProfilePublic | null;
  drafts: DraftPublic[];
  pauseForRestriction: boolean;
  signInRetained: boolean;
};

export async function loadAccountActions(
  sql: SqlLike,
  userId: string,
  accountId: string,
): Promise<AccountActionsSnapshot> {
  const [readiness, emailBindings, retainedProfile, drafts] = await Promise.all([
    getReadiness(sql, userId, accountId),
    listEmailBindings(sql, userId, accountId),
    getProfileForAccount(sql, userId, accountId),
    listDrafts(sql, userId, accountId),
  ]);
  return {
    accountId,
    readiness,
    emailBindings,
    retainedProfile,
    drafts,
    pauseForRestriction: shouldPauseForRestriction(readiness),
    signInRetained: retainedProfile ? isSignInRetained(retainedProfile) : false,
  };
}

export async function observeAccountReadiness(
  sql: SqlLike,
  userId: string,
  accountId: string,
  observations: Partial<Record<ReadinessCheckKey, CheckObservation>>,
): Promise<ReadinessReport> {
  const report = await observeReadiness(sql, { userId, accountId, observations });
  if (replacementAccountForbidden(report)) {
    const profile = await getProfileForAccount(sql, userId, accountId);
    if (profile) {
      await quarantineRestricted(sql, { userId, profileId: profile.id });
    }
  }
  return report;
}

export async function bindRecoveryEmail(
  sql: SqlLike,
  userId: string,
  input: Omit<CreateEmailBindingInput, "userId">,
) {
  return createEmailBinding(sql, { ...input, userId });
}

export async function verifyRecoveryEmail(sql: SqlLike, userId: string, bindingId: string) {
  return markDestinationVerified(sql, { userId, bindingId });
}

export async function removeRecoveryEmail(sql: SqlLike, userId: string, bindingId: string) {
  return deleteEmailBinding(sql, { userId, bindingId });
}

export async function draftAPost(
  sql: SqlLike,
  userId: string,
  input: Omit<GenerateDraftInput, "userId">,
  opts?: GenerateDraftOptions,
) {
  return generateDraft(sql, { ...input, userId }, opts);
}

/** Release the hosted browser. Does not disconnect OAuth or delete the Reddit account. */
export async function closeBrowser(
  sql: SqlLike,
  userId: string,
  accountId: string,
): Promise<{ released: boolean; profile: ProfilePublic | null }> {
  return releaseProfileLease(sql, { userId, accountId });
}

/**
 * Disable X Relay access for this connection. Does not close the Reddit account
 * and does not by itself delete a retained sign-in.
 */
export async function disconnectRelay(
  sql: SqlLike,
  userId: string,
  accountId: string,
): Promise<{ queued: boolean }> {
  await queueDisconnectCleanup(sql, { userId, accountId });
  return { queued: true };
}

/** Request deletion of retained browser sign-in only. */
export async function deleteRetainedSignIn(
  sql: SqlLike,
  userId: string,
  accountId: string,
): Promise<ProfilePublic> {
  const profile = await getProfileForAccount(sql, userId, accountId);
  if (!profile) {
    throw new OnboardingError("PROFILE_NOT_FOUND", "No retained sign-in for this account.");
  }
  return requestDeletion(sql, { userId, profileId: profile.id });
}

export async function confirmDeleteRetainedSignIn(
  sql: SqlLike,
  userId: string,
  accountId: string,
): Promise<ProfilePublic> {
  const profile = await getProfileForAccount(sql, userId, accountId);
  if (!profile) {
    throw new OnboardingError("PROFILE_NOT_FOUND", "No retained sign-in for this account.");
  }
  return confirmDeletion(sql, { userId, profileId: profile.id });
}

export async function reconnectAccount(
  sql: SqlLike,
  userId: string,
  accountId: string,
  opts: {
    leaseOwner: string;
    expected?: ProfileBinding;
    observedIdentity?: { username?: string; redditId?: string };
    authExpired?: boolean;
    restricted?: boolean;
  },
) {
  const profile = await getProfileForAccount(sql, userId, accountId);
  if (!profile) {
    throw new OnboardingError(
      "NO_RETAINED_SESSION",
      "There is no retained browser sign-in. Use Reddit login to reconnect the same account.",
    );
  }
  if (profile.retentionStatus === "needs_reauth" || profile.retentionStatus === "expired") {
    throw new OnboardingError(
      "NEEDS_REAUTH",
      "Sign in again with the same Reddit account. A new account will not be created.",
    );
  }
  return reopenProfile(sql, {
    userId,
    profileId: profile.id,
    leaseOwner: opts.leaseOwner,
    expected: opts.expected,
    observedIdentity: opts.observedIdentity,
    authExpired: opts.authExpired,
    restricted: opts.restricted,
  });
}

export async function expireSavedAuth(sql: SqlLike, userId: string, accountId: string) {
  const profile = await getProfileForAccount(sql, userId, accountId);
  if (!profile) throw new OnboardingError("PROFILE_NOT_FOUND", "No retained sign-in for this account.");
  return markNeedsReauth(sql, { userId, profileId: profile.id });
}
