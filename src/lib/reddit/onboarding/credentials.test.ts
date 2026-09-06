import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { queueCreateBatch } from "./batch.ts";
import { listBatchCredentials, readJobSignupPassword } from "./credentials.ts";
import { schema, toSql } from "./test-schema.ts";

describe("reddit create credentials", () => {
  it("stores a password for each queued create and can read it back", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await schema(pg);
    const sql = toSql(pg);
    const queued = await queueCreateBatch(sql, {
      userId: "user-a",
      count: 2,
      idempotencyKey: "creds-1",
    });
    const password = await readJobSignupPassword(sql, {
      userId: "user-a",
      jobId: queued.job.id,
    });
    assert.ok(password && password.length >= 8);
    const listed = await listBatchCredentials(sql, {
      userId: "user-a",
      batchId: queued.batch.id,
    });
    assert.equal(listed.length >= 1, true);
    assert.equal(listed[0]?.username, queued.job.expected_username);
    assert.equal(listed[0]?.password, password);
    await pg.close();
  });
});
