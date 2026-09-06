import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { OnboardingError } from "./types.ts";
import {
  approveDraft,
  buildDraftPrompt,
  directPublishEnabled,
  editDraft,
  generateDraft,
  preparePublication,
  recordPublicationOutcome,
  validateDraftContent,
} from "./drafts.ts";

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

const fakeGenerate = async () => ({
  title: "How we log Reddit health checks",
  body: "This draft explains the observed health fields. It does not claim personal exploits.",
  community: "learnprogramming",
  postType: "self",
  flair: null,
  fitExplanation: "The allowlist includes learnprogramming and the topic is tooling.",
});

describe("draft composer", () => {
  it("does not invent an allowlist and rejects off-list communities", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    await assert.rejects(
      () =>
        generateDraft(sql, {
          userId: "user-a",
          accountId: "acct-1",
          communityAllowlist: [],
          topic: "logging",
        }, { generate: fakeGenerate }),
      (err: unknown) => err instanceof OnboardingError && err.code === "ALLOWLIST_REQUIRED",
    );
    await assert.rejects(
      () =>
        generateDraft(
          sql,
          {
            userId: "user-a",
            accountId: "acct-1",
            communityAllowlist: ["learnprogramming"],
            topic: "logging",
          },
          {
            generate: async () => ({
              ...await fakeGenerate(),
              community: "help",
            }),
          },
        ),
      (err: unknown) => err instanceof OnboardingError && err.code === "COMMUNITY_NOT_ALLOWED",
    );
    await pg.close();
  });

  it("marks missing rules as rules_unknown and uses an injected generator", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const draft = await generateDraft(
      sql,
      {
        userId: "user-a",
        accountId: "acct-1",
        communityAllowlist: ["learnprogramming", "webdev"],
        topic: "health checks",
        selectedCommunity: "learnprogramming",
      },
      { generate: fakeGenerate },
    );
    assert.equal(draft.community, "learnprogramming");
    assert.equal(draft.validationStatus, "rules_unknown");
    assert.equal(draft.approvalStatus, "needs_review");
    await pg.close();
  });

  it("throws if secrets appear in the prompt builder and rejects invented claims", () => {
    assert.throws(
      () =>
        buildDraftPrompt({
          communityAllowlist: ["learnprogramming"],
          topic: "hi",
          password: "secret",
        } as unknown as { communityAllowlist: string[]; topic: string }),
      (err: unknown) => err instanceof OnboardingError && err.code === "SENSITIVE_PROMPT_INPUT",
    );
    assert.throws(
      () =>
        buildDraftPrompt({
          communityAllowlist: ["learnprogramming"],
          topic: "hi",
          otp: "111111",
        } as unknown as { communityAllowlist: string[]; topic: string }),
      (err: unknown) => err instanceof OnboardingError && err.code === "SENSITIVE_PROMPT_INPUT",
    );
    const bad = validateDraftContent({
      title: "I personally fixed production",
      body: "When I worked at Reddit as a verified admin, our product will guarantee karma.",
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.issues.some((i) => /first-person/i.test(i)));
    assert.ok(bad.issues.some((i) => /credential|affiliation|product/i.test(i)));
    const ok = validateDraftContent({
      title: "How the health panel reports unknown checks",
      body: "Unknown stays unknown until there is an observation.",
      community: "learnprogramming",
      allowlist: ["learnprogramming"],
    });
    assert.equal(ok.ok, true);
  });

  it("creates an immutable next version on edit and invalidates approval plus intents", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const previous = process.env.REDDIT_DIRECT_PUBLISH_ENABLED;
    process.env.REDDIT_DIRECT_PUBLISH_ENABLED = "true";
    try {
      const draft = await generateDraft(
        sql,
        {
          userId: "user-a",
          accountId: "acct-1",
          communityAllowlist: ["learnprogramming"],
          topic: "health checks",
          selectedCommunity: "learnprogramming",
          rulesSnapshotRef: "rules:learnprogramming:v1",
        },
        { generate: fakeGenerate },
      );
      assert.equal(draft.validationStatus, "ok");
      const approved = await approveDraft(sql, { userId: "user-a", draftId: draft.id });
      assert.equal(approved.approvalStatus, "approved");
      const intent = await preparePublication(sql, { userId: "user-a", draftId: draft.id });
      assert.equal(intent.status, "prepared");
      const edited = await editDraft(sql, {
        userId: "user-a",
        draftId: draft.id,
        body: "Edited copy still about the health panel.",
      });
      assert.equal(edited.version, draft.version + 1);
      assert.equal(edited.approvalStatus, "needs_review");
      assert.notEqual(edited.id, draft.id);
      const intents = await sql.query<{ status: string }>(
        `select status from reddit_publication_intents where draft_id = $1`,
        [draft.id],
      );
      assert.ok(intents.every((row) => row.status === "invalidated"));
    } finally {
      if (previous === undefined) delete process.env.REDDIT_DIRECT_PUBLISH_ENABLED;
      else process.env.REDDIT_DIRECT_PUBLISH_ENABLED = previous;
    }
    await pg.close();
  });

  it("keeps direct publish off by default and never blindly retries unknown outcomes", async () => {
    assert.equal(directPublishEnabled(), false);
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const draft = await generateDraft(
      sql,
      {
        userId: "user-a",
        accountId: "acct-1",
        communityAllowlist: ["learnprogramming"],
        topic: "health checks",
        selectedCommunity: "learnprogramming",
        rulesSnapshotRef: "rules:learnprogramming:v1",
      },
      { generate: fakeGenerate },
    );
    await assert.rejects(
      () => preparePublication(sql, { userId: "user-a", draftId: draft.id }),
      (err: unknown) => err instanceof OnboardingError && err.code === "DIRECT_PUBLISH_DISABLED",
    );
    const previous = process.env.REDDIT_DIRECT_PUBLISH_ENABLED;
    process.env.REDDIT_DIRECT_PUBLISH_ENABLED = "true";
    try {
      await approveDraft(sql, { userId: "user-a", draftId: draft.id });
      const intent = await preparePublication(sql, { userId: "user-a", draftId: draft.id });
      const unknown = await recordPublicationOutcome(sql, {
        userId: "user-a",
        intentId: intent.id,
        outcome: "submitted_unknown",
      });
      assert.equal(unknown.status, "submitted_unknown");
      await assert.rejects(
        () =>
          recordPublicationOutcome(sql, {
            userId: "user-a",
            intentId: intent.id,
            outcome: "posted",
            redditPostId: "abc",
          }),
        (err: unknown) => err instanceof OnboardingError && err.code === "PUBLICATION_UNKNOWN",
      );
      await assert.rejects(
        () => preparePublication(sql, { userId: "user-a", draftId: draft.id }),
        (err: unknown) => err instanceof OnboardingError && err.code === "PUBLICATION_UNKNOWN",
      );
    } finally {
      if (previous === undefined) delete process.env.REDDIT_DIRECT_PUBLISH_ENABLED;
      else process.env.REDDIT_DIRECT_PUBLISH_ENABLED = previous;
    }
    await pg.close();
  });

  it("does not call live OpenRouter without an explicit live flag", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    await assert.rejects(
      () =>
        generateDraft(sql, {
          userId: "user-a",
          accountId: "acct-1",
          communityAllowlist: ["learnprogramming"],
          topic: "health checks",
        }),
      (err: unknown) => err instanceof OnboardingError && err.code === "GENERATOR_REQUIRED",
    );
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await assert.rejects(
        () =>
          generateDraft(
            sql,
            {
              userId: "user-a",
              accountId: "acct-1",
              communityAllowlist: ["learnprogramming"],
              topic: "health checks",
              selectedCommunity: "learnprogramming",
            },
            { live: true },
          ),
        (err: unknown) => err instanceof OnboardingError && err.code === "OPENROUTER_NOT_CONFIGURED",
      );
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous;
    }
    await pg.close();
  });
});
