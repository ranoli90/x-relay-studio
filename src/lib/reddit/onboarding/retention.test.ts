import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OnboardingError } from "./types.ts";
import {
  confirmDeletion,
  confirmPersisted,
  createBrowserProfile,
  isSignInRetained,
  markNeedsReauth,
  quarantineRestricted,
  releaseProfileLease,
  reopenProfile,
  requestDeletion,
  requestRetention,
  retentionLabel,
} from "./retention.ts";
import { schema, toSql } from "./test-schema.ts";
import { closeBrowser, disconnectRelay, loadAccountActions } from "./account-actions.ts";

describe("retained sign-in", () => {
  it("does not treat a retention request as saved", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const profile = await createBrowserProfile(sql, {
      userId: "user-a",
      originJobId: "00000000-0000-0000-0000-000000000001",
      provider: "fake",
      accountId: "acct-1",
      providerProjectId: "proj-1",
      environmentId: "preview",
      workflowVersion: "email-signup.v1",
      redditId: "t2_1",
      lastVerifiedUsername: "alice",
    });
    const requested = await requestRetention(sql, { userId: "user-a", profileId: profile.id });
    assert.equal(requested.retentionRequested, true);
    assert.equal(requested.retentionStatus, "requested");
    assert.equal(isSignInRetained(requested), false);
    assert.match(retentionLabel(requested.retentionStatus), /not saved/i);
    const retained = await confirmPersisted(sql, {
      userId: "user-a",
      profileId: profile.id,
      expiresAt: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(retained.retentionStatus, "retained");
    assert.equal(isSignInRetained(retained), true);
    assert.equal(retained.expiresAt?.startsWith("2026-10-01"), true);
    await pg.close();
  });

  it("reopens only the bound retained profile under an exclusive lease", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const profile = await createBrowserProfile(sql, {
      userId: "user-a",
      originJobId: "job-1",
      provider: "fake",
      accountId: "acct-1",
      providerProjectId: "proj-1",
      environmentId: "preview",
      workflowVersion: "email-signup.v1",
      redditId: "t2_1",
      lastVerifiedUsername: "alice",
    });
    await requestRetention(sql, { userId: "user-a", profileId: profile.id });
    await confirmPersisted(sql, {
      userId: "user-a",
      profileId: profile.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const first = await reopenProfile(sql, {
      userId: "user-a",
      profileId: profile.id,
      leaseOwner: "worker-1",
      expected: {
        accountId: "acct-1",
        provider: "fake",
        providerProjectId: "proj-1",
        environmentId: "preview",
        workflowVersion: "email-signup.v1",
        username: "alice",
      },
      observedIdentity: { username: "alice", redditId: "t2_1" },
      leaseSeconds: 120,
    });
    assert.equal(first.profile.leaseOwner, "worker-1");
    await assert.rejects(
      () =>
        reopenProfile(sql, {
          userId: "user-a",
          profileId: profile.id,
          leaseOwner: "worker-2",
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "PROFILE_LEASE_HELD",
    );
    await assert.rejects(
      () =>
        reopenProfile(sql, {
          userId: "user-b",
          profileId: profile.id,
          leaseOwner: "worker-9",
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "PROFILE_NOT_FOUND",
    );
    await releaseProfileLease(sql, { userId: "user-a", profileId: profile.id, leaseOwner: "worker-1" });
    await assert.rejects(
      () =>
        reopenProfile(sql, {
          userId: "user-a",
          profileId: profile.id,
          leaseOwner: "worker-3",
          expected: { providerProjectId: "other-project" },
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "PROFILE_MISMATCH",
    );
    await assert.rejects(
      () =>
        reopenProfile(sql, {
          userId: "user-a",
          profileId: profile.id,
          leaseOwner: "worker-3",
          observedIdentity: { username: "not-alice" },
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "IDENTITY_MISMATCH",
    );
    await pg.close();
  });

  it("sends expired auth to reauth and restrictions to quarantine", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const profile = await createBrowserProfile(sql, {
      userId: "user-a",
      originJobId: "job-1",
      provider: "fake",
      accountId: "acct-1",
      lastVerifiedUsername: "alice",
      redditId: "t2_1",
    });
    await requestRetention(sql, { userId: "user-a", profileId: profile.id });
    await confirmPersisted(sql, {
      userId: "user-a",
      profileId: profile.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const accountsBefore = await sql.query<{ n: string }>(`select count(*)::text as n from reddit_accounts`);
    await assert.rejects(
      () =>
        reopenProfile(sql, {
          userId: "user-a",
          profileId: profile.id,
          leaseOwner: "worker-1",
          authExpired: true,
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "NEEDS_REAUTH",
    );
    const reauth = await markNeedsReauth(sql, { userId: "user-a", profileId: profile.id });
    assert.equal(reauth.retentionStatus, "needs_reauth");
    await assert.rejects(
      () =>
        reopenProfile(sql, {
          userId: "user-a",
          profileId: profile.id,
          leaseOwner: "worker-1",
          restricted: true,
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "ACCOUNT_RESTRICTED",
    );
    const paused = await quarantineRestricted(sql, { userId: "user-a", profileId: profile.id });
    assert.equal(paused.status, "quarantined");
    const accountsAfter = await sql.query<{ n: string }>(`select count(*)::text as n from reddit_accounts`);
    assert.equal(accountsAfter[0].n, accountsBefore[0].n);
    await pg.close();
  });

  it("tracks deletion through confirmation and blocks reopen of deleting or orphaned profiles", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const orphan = await createBrowserProfile(sql, {
      userId: "user-a",
      originJobId: "job-orphan",
      provider: "fake",
    });
    await requestRetention(sql, { userId: "user-a", profileId: orphan.id });
    await confirmPersisted(sql, {
      userId: "user-a",
      profileId: orphan.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await assert.rejects(
      () => reopenProfile(sql, { userId: "user-a", profileId: orphan.id, leaseOwner: "w" }),
      (err: unknown) => err instanceof OnboardingError && err.code === "PROFILE_CANNOT_REOPEN",
    );

    const profile = await createBrowserProfile(sql, {
      userId: "user-a",
      originJobId: "job-2",
      provider: "fake",
      accountId: "acct-1",
      providerContextId: "ctx-1",
      lastVerifiedUsername: "alice",
    });
    await requestRetention(sql, { userId: "user-a", profileId: profile.id });
    await confirmPersisted(sql, {
      userId: "user-a",
      profileId: profile.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const pending = await requestDeletion(sql, { userId: "user-a", profileId: profile.id });
    assert.equal(pending.retentionStatus, "delete_pending");
    assert.equal(pending.deletionState, "requested");
    await assert.rejects(
      () => reopenProfile(sql, { userId: "user-a", profileId: profile.id, leaseOwner: "w" }),
      (err: unknown) => err instanceof OnboardingError && err.code === "PROFILE_CANNOT_REOPEN",
    );
    const deleted = await confirmDeletion(sql, { userId: "user-a", profileId: profile.id });
    assert.equal(deleted.retentionStatus, "deleted");
    assert.equal(deleted.deletionState, "confirmed");
    await assert.rejects(
      () => reopenProfile(sql, { userId: "user-a", profileId: profile.id, leaseOwner: "w" }),
      (err: unknown) => err instanceof OnboardingError && err.code === "PROFILE_CANNOT_REOPEN",
    );
    await pg.close();
  });

  it("keeps close browser, disconnect, and delete retained as separate actions", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const profile = await createBrowserProfile(sql, {
      userId: "user-a",
      originJobId: "job-3",
      provider: "fake",
      accountId: "acct-1",
      lastVerifiedUsername: "alice",
      redditId: "t2_1",
    });
    await sql.query(
      `insert into reddit_accounts (id, user_id, reddit_id, name) values ($1,$2,$3,$4)`,
      ["acct-1", "user-a", "t2_1", "alice"],
    );
    await requestRetention(sql, { userId: "user-a", profileId: profile.id });
    await confirmPersisted(sql, {
      userId: "user-a",
      profileId: profile.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await reopenProfile(sql, {
      userId: "user-a",
      profileId: profile.id,
      leaseOwner: "worker-1",
      observedIdentity: { username: "alice" },
    });
    const closed = await closeBrowser(sql, "user-a", "acct-1");
    assert.equal(closed.released, true);
    assert.equal(closed.profile?.retentionStatus, "retained");
    const disconnect = await disconnectRelay(sql, "user-a", "acct-1");
    assert.equal(disconnect.queued, true);
    const still = await loadAccountActions(sql, "user-a", "acct-1");
    assert.equal(still.signInRetained, true);
    assert.equal(still.pauseForRestriction, false);
    assert.equal(still.readiness.cqsClaim, null);
    assert.equal(still.readiness.inventedReputation, false);
    await pg.close();
  });
});
