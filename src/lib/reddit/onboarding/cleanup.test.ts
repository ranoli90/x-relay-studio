import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  claimCleanup,
  expireRetainedProfiles,
  queueDisconnectCleanup,
  runCleanupTask,
} from "./cleanup.ts";
import { createOrReuseDraft, enqueueCleanup } from "./store.ts";
import { FakeBrowserProvider, resetFakeProvider } from "./providers/fake.ts";
import { DEFAULT_SESSION_POLICY, type BrowserProvider } from "./provider.ts";
import { encryptV2 } from "./vault.ts";
import { schema, toSql } from "./test-schema.ts";

async function boot() {
  const pg = new PGlite();
  await pg.waitReady;
  await schema(pg);
  return { pg, sql: toSql(pg) };
}

function stubProvider(over: Partial<BrowserProvider> = {}): BrowserProvider {
  const fake = new FakeBrowserProvider();
  return Object.assign(fake, over);
}

describe("queueDisconnectCleanup", () => {
  it("queues required cleanup kinds and ignores a duplicate enqueue", async () => {
    const { pg, sql } = await boot();
    process.env.SECRETS_ENCRYPTION_KEY = "cleanup-test-key";
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "cleanup-draft",
      body: {},
    });
    const opts = {
      userId: "user-a",
      accountId: "acc-1",
      jobId: created.job.id,
      refreshToken: "refresh-token-value",
      sessionId: "ses-1",
      contextId: "ctx-1",
    };
    await queueDisconnectCleanup(sql, opts);
    await queueDisconnectCleanup(sql, opts);
    const rows = await sql.query<{ kind: string; n: number }>(
      `select kind, count(*)::int as n from reddit_cleanup_tasks
        where user_id = $1 group by kind order by kind`,
      ["user-a"],
    );
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
    assert.equal(byKind.revoke_oauth, 1);
    assert.equal(byKind.release_session, 1);
    assert.equal(byKind.delete_context, 1);
    assert.equal(byKind.purge_temporary_secret, 1);
    assert.equal(byKind.confirm_local_disconnect, 1);
    await pg.close();
  });
});

describe("claimCleanup", () => {
  it("leases one queued task and does not give the same id to a second worker", async () => {
    const { pg, sql } = await boot();
    await enqueueCleanup(sql, { userId: "user-a", kind: "release_session", target: "ses-claim" });
    const first = await claimCleanup(sql, "worker-1");
    const second = await claimCleanup(sql, "worker-2");
    assert.ok(first);
    assert.equal(first.id, first.id);
    assert.equal(second, null);
    assert.equal(first.status, "leased");
    await pg.close();
  });
});

describe("runCleanupTask", () => {
  it("releases a session, retries when it is still running, and records cleanup_completed", async () => {
    const { pg, sql } = await boot();
    resetFakeProvider();
    const created = await createOrReuseDraft(sql, {
      userId: "user-a",
      mode: "manual",
      intent: "create",
      idempotencyKey: "release-job",
      body: {},
    });
    const provider = new FakeBrowserProvider();
    const session = await provider.createSession({
      jobId: created.job.id,
      allocationIntentId: "alloc-1",
      generation: 1,
      policy: DEFAULT_SESSION_POLICY,
    });
    await enqueueCleanup(sql, {
      userId: "user-a",
      jobId: created.job.id,
      kind: "release_session",
      target: session.sessionId,
    });
    const task = await claimCleanup(sql, "worker-1");
    assert.ok(task);
    const done = await runCleanupTask(sql, task, provider);
    assert.equal(done.pending, false);
    const finished = await sql.query<{ status: string }>(
      `select status from reddit_cleanup_tasks where id = $1`,
      [task.id],
    );
    assert.equal(finished[0]?.status, "completed");
    const events = await sql.query<{ event_type: string }>(
      `select event_type from reddit_onboarding_events where job_id = $1 and event_type = 'cleanup_completed'`,
      [created.job.id],
    );
    assert.equal(events.length, 1);

    provider.releaseDoesNotEnd = true;
    const session2 = await provider.createSession({
      jobId: created.job.id,
      allocationIntentId: "alloc-2",
      generation: 1,
      policy: DEFAULT_SESSION_POLICY,
    });
    await enqueueCleanup(sql, {
      userId: "user-a",
      jobId: created.job.id,
      kind: "release_session",
      target: session2.sessionId,
    });
    const pendingTask = await claimCleanup(sql, "worker-1");
    assert.ok(pendingTask);
    const pending = await runCleanupTask(sql, pendingTask, provider);
    assert.equal(pending.pending, true);
    const retried = await sql.query<{ status: string; last_error_code: string | null }>(
      `select status, last_error_code from reddit_cleanup_tasks where id = $1`,
      [pendingTask.id],
    );
    assert.equal(retried[0]?.status, "queued");
    assert.equal(retried[0]?.last_error_code, "SESSION_STILL_RUNNING");
    await pg.close();
  });

  it("retries delete_context when the provider has not confirmed deletion", async () => {
    const { pg, sql } = await boot();
    await enqueueCleanup(sql, { userId: "user-a", kind: "delete_context", target: "ctx-pending" });
    const task = await claimCleanup(sql, "worker-1");
    assert.ok(task);
    const result = await runCleanupTask(
      sql,
      task,
      stubProvider({ deleteContext: async () => ({ deleted: false }) }),
    );
    assert.equal(result.pending, true);
    const row = await sql.query<{ last_error_code: string | null; status: string }>(
      `select last_error_code, status from reddit_cleanup_tasks where id = $1`,
      [task.id],
    );
    assert.equal(row[0]?.status, "queued");
    assert.equal(row[0]?.last_error_code, "CONTEXT_DELETE_PENDING");
    await pg.close();
  });

  it("handles revoke_oauth material, missing revoker, failure, and success", async () => {
    const { pg, sql } = await boot();
    process.env.SECRETS_ENCRYPTION_KEY = "cleanup-test-key";
    const provider = new FakeBrowserProvider();
    const material = encryptV2("rt-1", {
      userId: "user-a",
      recordId: "acc-rev",
      purpose: "oauth_revocation_material",
    });

    await enqueueCleanup(sql, {
      userId: "user-a",
      kind: "revoke_oauth",
      target: "oauth:none",
    });
    const noMaterial = await claimCleanup(sql, "worker-1");
    assert.ok(noMaterial);
    const missing = await runCleanupTask(sql, noMaterial, provider);
    assert.equal(missing.pending, false);
    const failed = await sql.query<{ status: string; last_error_code: string | null }>(
      `select status, last_error_code from reddit_cleanup_tasks where id = $1`,
      [noMaterial.id],
    );
    assert.equal(failed[0]?.status, "failed");
    assert.equal(failed[0]?.last_error_code, "NO_MATERIAL");

    await enqueueCleanup(sql, {
      userId: "user-a",
      accountId: "acc-rev",
      kind: "revoke_oauth",
      target: "oauth:acc-rev",
      encryptedMaterial: material,
    });
    const withMaterial = await claimCleanup(sql, "worker-1");
    assert.ok(withMaterial);
    assert.equal(withMaterial.kind, "revoke_oauth");
    const needRevoker = await runCleanupTask(sql, withMaterial, provider);
    assert.equal(needRevoker.pending, true);
    const retried = await sql.query<{ last_error_code: string | null }>(
      `select last_error_code from reddit_cleanup_tasks where id = $1`,
      [withMaterial.id],
    );
    assert.equal(retried[0]?.last_error_code, "REVOKER_MISSING");

    await enqueueCleanup(sql, {
      userId: "user-a",
      accountId: "acc-fail",
      kind: "revoke_oauth",
      target: "oauth:acc-fail",
      encryptedMaterial: material,
    });
    const failTask = await claimCleanup(sql, "worker-1");
    assert.ok(failTask);
    const httpFail = await runCleanupTask(sql, failTask, provider, async () => ({ ok: false }));
    assert.equal(httpFail.pending, true);
    const httpRow = await sql.query<{ last_error_code: string | null }>(
      `select last_error_code from reddit_cleanup_tasks where id = $1`,
      [failTask.id],
    );
    assert.equal(httpRow[0]?.last_error_code, "REVOKE_HTTP_FAILED");

    await enqueueCleanup(sql, {
      userId: "user-a",
      accountId: "acc-ok",
      kind: "revoke_oauth",
      target: "oauth:acc-ok",
      encryptedMaterial: material,
    });
    const okTask = await claimCleanup(sql, "worker-1");
    assert.ok(okTask);
    const ok = await runCleanupTask(sql, okTask, provider, async () => ({ ok: true }));
    assert.equal(ok.pending, false);
    const done = await sql.query<{ status: string }>(
      `select status from reddit_cleanup_tasks where id = $1`,
      [okTask.id],
    );
    assert.equal(done[0]?.status, "completed");
    await pg.close();
  });

  it("purges temporary secrets and confirms local disconnect", async () => {
    const { pg, sql } = await boot();
    await sql.query(
      `insert into reddit_accounts (id, user_id, reddit_id, name, onboarded_at, cleanup_pending)
       values ($1,$2,$3,$4, now(), true)`,
      ["acc-1", "user-a", "rid-1", "alice"],
    );
    await sql.query(
      `insert into reddit_secret_entries
         (id, user_id, purpose, account_id, ciphertext, envelope_version, key_id)
       values
         ('s-temp', 'user-a', 'signup_email', 'acc-1', 'cipher-temp', 'v2', 'k1'),
         ('s-keep', 'user-a', 'retained_reddit_password', 'acc-1', 'cipher-keep', 'v2', 'k1')`,
    );
    await enqueueCleanup(sql, {
      userId: "user-a",
      accountId: "acc-1",
      kind: "purge_temporary_secret",
      target: "secrets:acc-1",
    });
    await enqueueCleanup(sql, {
      userId: "user-a",
      accountId: "acc-1",
      kind: "confirm_local_disconnect",
      target: "account:acc-1",
    });
    const provider = new FakeBrowserProvider();
    const first = await claimCleanup(sql, "worker-1");
    assert.ok(first);
    assert.equal((await runCleanupTask(sql, first, provider)).pending, false);
    const second = await claimCleanup(sql, "worker-1");
    assert.ok(second);
    assert.equal((await runCleanupTask(sql, second, provider)).pending, false);
    assert.deepEqual(
      [first.kind, second.kind].sort(),
      ["confirm_local_disconnect", "purge_temporary_secret"],
    );

    const secrets = await sql.query<{ id: string; ciphertext: string; deleted_at: string | Date | null }>(
      `select id, ciphertext, deleted_at from reddit_secret_entries order by id`,
    );
    const temp = secrets.find((s) => s.id === "s-temp");
    const keep = secrets.find((s) => s.id === "s-keep");
    assert.equal(temp?.ciphertext, "purged");
    assert.ok(temp?.deleted_at);
    assert.equal(keep?.ciphertext, "cipher-keep");
    assert.equal(keep?.deleted_at, null);

    const account = await sql.query<{ cleanup_pending: boolean }>(
      `select cleanup_pending from reddit_accounts where id = $1`,
      ["acc-1"],
    );
    assert.equal(account[0]?.cleanup_pending, false);
    await pg.close();
  });

  it("retries when the provider throws", async () => {
    const { pg, sql } = await boot();
    await enqueueCleanup(sql, { userId: "user-a", kind: "release_session", target: "ses-throw" });
    const task = await claimCleanup(sql, "worker-1");
    assert.ok(task);
    const result = await runCleanupTask(
      sql,
      task,
      stubProvider({
        requestRelease: async () => {
          throw new Error("provider down");
        },
      }),
    );
    assert.equal(result.pending, true);
    const row = await sql.query<{ last_error_code: string | null }>(
      `select last_error_code from reddit_cleanup_tasks where id = $1`,
      [task.id],
    );
    assert.equal(row[0]?.last_error_code, "CLEANUP_ERROR");
    await pg.close();
  });
});

describe("expireRetainedProfiles", () => {
  it("marks expired profiles deleting and queues context cleanup", async () => {
    const { pg, sql } = await boot();
    await sql.query(
      `insert into reddit_browser_profiles
         (id, user_id, origin_job_id, provider, provider_context_id, status, expires_at)
       values
         ('p-expired', 'user-a', 'job-1', 'fake', 'ctx-expired', 'retained', now() - interval '1 day'),
         ('p-live', 'user-a', 'job-1', 'fake', 'ctx-live', 'retained', now() + interval '30 days'),
         ('p-none', 'user-a', 'job-1', 'fake', null, 'temporary', now() - interval '1 day')`,
    );
    const n = await expireRetainedProfiles(sql);
    assert.equal(n, 2);
    const profiles = await sql.query<{ id: string; status: string }>(
      `select id, status from reddit_browser_profiles order by id`,
    );
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p.status]));
    assert.equal(byId["p-expired"], "deleting");
    assert.equal(byId["p-none"], "deleting");
    assert.equal(byId["p-live"], "retained");
    const tasks = await sql.query<{ target_reference: string }>(
      `select target_reference from reddit_cleanup_tasks where kind = 'delete_context'`,
    );
    assert.deepEqual(
      tasks.map((t) => t.target_reference).sort(),
      ["ctx-expired"],
    );
    await pg.close();
  });
});

describe("disableAndQueueDisconnect RC-020/022", () => {
  it("will not clear cleanup_pending while a required child is still queued", async () => {
    const { pg, sql } = await boot();
    await sql.query(
      `insert into reddit_accounts (id, user_id, reddit_id, name, onboarded_at, cleanup_pending)
       values ($1,$2,$3,$4, now(), true)`,
      ["acc-pending", "user-a", "rid-pending", "alice"],
    );
    await enqueueCleanup(sql, {
      userId: "user-a",
      accountId: "acc-pending",
      kind: "revoke_oauth",
      target: "oauth:acc-pending",
    });
    await enqueueCleanup(sql, {
      userId: "user-a",
      accountId: "acc-pending",
      kind: "confirm_local_disconnect",
      target: "account:acc-pending",
    });
    const summary = await sql.query<{ id: string }>(
      `select id from reddit_cleanup_tasks where kind = 'confirm_local_disconnect' and account_id = $1`,
      ["acc-pending"],
    );
    const provider = new FakeBrowserProvider();
    const result = await runCleanupTask(
      sql,
      {
        id: summary[0].id,
        user_id: "user-a",
        job_id: null,
        account_id: "acc-pending",
        kind: "confirm_local_disconnect",
        target_reference: "account:acc-pending",
        encrypted_revocation_material: null,
        attempt: 1,
        status: "leased",
        lease_owner: "worker-1",
        lease_generation: 1,
      },
      provider,
    );
    assert.equal(result.pending, true);
    const account = await sql.query<{ cleanup_pending: boolean }>(
      `select cleanup_pending from reddit_accounts where id = $1`,
      ["acc-pending"],
    );
    assert.equal(account[0]?.cleanup_pending, true);
    await pg.close();
  });

  it("rolls disable and cleanup back when a later write fails", async () => {
    const { pg, sql } = await boot();
    process.env.SECRETS_ENCRYPTION_KEY = "cleanup-test-key";
    await sql.query(
      `insert into reddit_accounts (id, user_id, reddit_id, name, onboarded_at)
       values ($1,$2,$3,$4, now())`,
      ["acc-tx", "user-a", "rid-tx", "alice"],
    );
    let writes = 0;
    const wrapped = {
      query: async <T>(text: string, params: unknown[] = []) => {
        if (/insert into reddit_cleanup_tasks/i.test(text)) {
          writes += 1;
          if (writes === 1) throw new Error("injected cleanup failure");
        }
        return sql.query<T>(text, params);
      },
    };
    const { disableAndQueueDisconnect } = await import("./cleanup.ts");
    await assert.rejects(
      () => disableAndQueueDisconnect(wrapped, { userId: "user-a", accountId: "acc-tx", refreshToken: "r" }),
      /injected cleanup failure/,
    );
    const account = await sql.query<{ disabled_at: string | Date | null }>(
      `select disabled_at from reddit_accounts where id = $1`,
      ["acc-tx"],
    );
    assert.equal(account[0]?.disabled_at, null);
    const tasks = await sql.query(`select id from reddit_cleanup_tasks where account_id = $1`, ["acc-tx"]);
    assert.equal(tasks.length, 0);
    await pg.close();
  });
});
