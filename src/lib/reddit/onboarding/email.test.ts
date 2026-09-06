import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OnboardingError } from "./types.ts";
import {
  createEmailBinding,
  deleteEmailBinding,
  emailCreateFingerprint,
  listEmailBindings,
  markDestinationVerified,
  reconcilePendingCreate,
  redditEmailVerifiedFromBinding,
} from "./email.ts";
import { decryptV2 } from "./vault.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

async function schema(pg: PGlite) {
  const sql027 = readFileSync(new URL("../../../../migrations/0027_reddit_onboarding.sql", import.meta.url), "utf8");
  const sql028 = readFileSync(new URL("../../../../migrations/0028_reddit_onboarding_backfill.sql", import.meta.url), "utf8");
  const sql029 = readFileSync(new URL("../../../../migrations/0029_reddit_onboarding_lifecycle.sql", import.meta.url), "utf8");
  await pg.exec(`
    create table reddit_apps (
      user_id text primary key,
      client_id text not null,
      client_secret text not null,
      user_agent_name text not null,
      redirect_uri text not null
    );
    create table reddit_accounts (
      id text primary key,
      user_id text not null,
      reddit_id text not null,
      name text not null,
      onboarded_at timestamptz,
      created_at timestamptz not null default now(),
      unique (user_id, reddit_id)
    );
    create table reddit_oauth_tickets (
      ticket text primary key,
      user_id text not null,
      state text not null,
      redirect_uri text not null,
      expires_at timestamptz not null
    );
  `);
  await pg.exec(sql027);
  await pg.exec(sql028);
  await pg.exec(sql029);
}

describe("email bindings", () => {
  it("defaults to existing_inbox and works without a provider", async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-email-bindings";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const binding = await createEmailBinding(sql, {
      userId: "user-a",
      address: "Alex@Example.com",
    });
    assert.equal(binding.kind, "existing_inbox");
    assert.equal(binding.provider, "owner");
    assert.equal(binding.maskedDisplay, "a•••@example.com");
    assert.equal(binding.status, "requested");
    assert.equal(binding.destinationVerified, false);
    assert.equal(redditEmailVerifiedFromBinding(binding), false);

    const stored = await sql.query<{ address_ciphertext: string; masked_display: string }>(
      `select address_ciphertext, masked_display from reddit_email_bindings where id = $1`,
      [binding.id],
    );
    assert.equal(stored[0].masked_display.includes("example.com"), true);
    assert.equal(stored[0].address_ciphertext.includes("alex@example.com"), false);
    const plain = decryptV2(stored[0].address_ciphertext, {
      userId: "user-a",
      recordId: binding.id,
      purpose: "signup_email",
    });
    assert.equal(plain, "alex@example.com");
    await pg.close();
  });

  it("blocks managed kinds when provider or domain is missing", async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-email-bindings";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    await assert.rejects(
      () =>
        createEmailBinding(sql, {
          userId: "user-a",
          kind: "owned_domain_alias",
          address: "alias@desk.example",
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "EMAIL_PROVIDER_UNAVAILABLE",
    );
    await assert.rejects(
      () =>
        createEmailBinding(sql, {
          userId: "user-a",
          kind: "managed_inbox",
          provider: "agentmail",
          address: "box@agentmail.example",
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "EMAIL_PROVIDER_UNAVAILABLE",
    );
    const existing = await createEmailBinding(sql, {
      userId: "user-a",
      address: "owner@example.com",
    });
    assert.equal(existing.kind, "existing_inbox");
    await pg.close();
  });

  it("reconciles a timed-out provider create instead of opening another", async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-email-bindings";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const first = await createEmailBinding(sql, {
      userId: "user-a",
      kind: "owned_domain_alias",
      provider: "cloudflare",
      domain: "desk.example",
      address: "alias@desk.example",
    });
    assert.equal(first.status, "pending");
    const again = await createEmailBinding(sql, {
      userId: "user-a",
      kind: "owned_domain_alias",
      provider: "cloudflare",
      domain: "desk.example",
      address: "alias@desk.example",
    });
    assert.equal(again.id, first.id);
    const fp = emailCreateFingerprint({
      userId: "user-a",
      kind: "owned_domain_alias",
      provider: "cloudflare",
      address: "alias@desk.example",
    });
    const reconciled = await reconcilePendingCreate(sql, {
      userId: "user-a",
      fingerprint: fp,
      providerResourceRef: "cf_route_1",
      outcome: "created",
    });
    assert.equal(reconciled?.id, first.id);
    assert.equal(reconciled?.status, "requested");
    const count = await sql.query<{ n: string }>(`select count(*)::text as n from reddit_email_bindings`);
    assert.equal(Number(count[0].n), 1);
    await pg.close();
  });

  it("stops when quota is blocked and still allows existing_inbox", async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-email-bindings";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const pending = await createEmailBinding(sql, {
      userId: "user-a",
      kind: "managed_inbox",
      provider: "agentmail",
      domain: "agent.example",
      address: "one@agent.example",
    });
    const fp = emailCreateFingerprint({
      userId: "user-a",
      kind: "managed_inbox",
      provider: "agentmail",
      address: "one@agent.example",
    });
    await reconcilePendingCreate(sql, {
      userId: "user-a",
      fingerprint: fp,
      outcome: "quota_blocked",
    });
    await assert.rejects(
      () =>
        createEmailBinding(sql, {
          userId: "user-a",
          kind: "managed_inbox",
          provider: "agentmail",
          domain: "agent.example",
          address: "two@agent.example",
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "QUOTA_BLOCKED",
    );
    const existing = await createEmailBinding(sql, {
      userId: "user-a",
      address: "keep@example.com",
    });
    assert.equal(existing.kind, "existing_inbox");
    const listed = await listEmailBindings(sql, "user-a");
    assert.ok(listed.some((b) => b.id === pending.id));
    await pg.close();
  });

  it("requires a verified alternative before deleting an in-use recovery address", async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-email-bindings";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const primary = await createEmailBinding(sql, {
      userId: "user-a",
      accountId: "acct-1",
      address: "primary@example.com",
    });
    await markDestinationVerified(sql, { userId: "user-a", bindingId: primary.id });
    await assert.rejects(
      () => deleteEmailBinding(sql, { userId: "user-a", bindingId: primary.id }),
      (err: unknown) => err instanceof OnboardingError && err.code === "EMAIL_RECOVERY_REQUIRED",
    );
    const alt = await createEmailBinding(sql, {
      userId: "user-a",
      accountId: "acct-1",
      address: "alt@example.com",
    });
    await markDestinationVerified(sql, { userId: "user-a", bindingId: alt.id });
    const deleted = await deleteEmailBinding(sql, { userId: "user-a", bindingId: primary.id });
    assert.equal(deleted.status, "deleted");
    const remaining = await listEmailBindings(sql, "user-a");
    assert.equal(remaining.some((b) => b.id === primary.id), false);
    await pg.close();
  });

  it("rejects OTP or message body fields and does not treat destination verify as Reddit verify", async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-email-bindings";
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    await assert.rejects(
      () =>
        createEmailBinding(sql, {
          userId: "user-a",
          address: "safe@example.com",
          otp: "123456",
        } as unknown as { userId: string; address: string }),
      (err: unknown) => err instanceof OnboardingError && err.code === "SENSITIVE_EMAIL_INPUT",
    );
    const binding = await createEmailBinding(sql, {
      userId: "user-a",
      address: "safe@example.com",
    });
    const verified = await markDestinationVerified(sql, { userId: "user-a", bindingId: binding.id });
    assert.equal(verified.destinationVerified, true);
    assert.equal(redditEmailVerifiedFromBinding(verified), false);
    await pg.close();
  });
});
