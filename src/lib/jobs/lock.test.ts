import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CRON_LEASE_NAME, claimAppLease, releaseAppLease } from "./lock.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

const SCHEMA = `
  create table app_leases (
    name text primary key,
    owner text,
    until timestamptz
  );
`;

describe("F13/F14 cron app leases", () => {
  it("a live owner blocks a second claim", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    const sql = toSql(pg);
    assert.equal(await claimAppLease(sql, CRON_LEASE_NAME, "owner_a", 120), true);
    assert.equal(await claimAppLease(sql, CRON_LEASE_NAME, "owner_b", 120), false);
    const row = (await pg.query<{ owner: string }>("select owner from app_leases")).rows[0];
    assert.equal(row.owner, "owner_a");
    await pg.close();
  });

  it("a stale owner cannot release a newer owner", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    const sql = toSql(pg);
    assert.equal(await claimAppLease(sql, CRON_LEASE_NAME, "owner_a", 120), true);
    await pg.exec(`update app_leases set until = now() - interval '1 second'`);
    assert.equal(await claimAppLease(sql, CRON_LEASE_NAME, "owner_b", 120), true);
    assert.equal(await releaseAppLease(sql, CRON_LEASE_NAME, "owner_a"), false);
    const row = (await pg.query<{ owner: string }>("select owner from app_leases")).rows[0];
    assert.equal(row.owner, "owner_b");
    assert.equal(await releaseAppLease(sql, CRON_LEASE_NAME, "owner_b"), true);
    const cleared = (await pg.query<{ owner: string | null }>("select owner from app_leases")).rows[0];
    assert.equal(cleared.owner, null);
    await pg.close();
  });

  it("an expired lease can be claimed by a new owner", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(SCHEMA);
    const sql = toSql(pg);
    assert.equal(await claimAppLease(sql, CRON_LEASE_NAME, "owner_a", 120), true);
    await pg.exec(`update app_leases set until = now() - interval '1 second'`);
    assert.equal(await claimAppLease(sql, CRON_LEASE_NAME, "owner_b", 120), true);
    const row = (await pg.query<{ owner: string }>("select owner from app_leases")).rows[0];
    assert.equal(row.owner, "owner_b");
    await pg.close();
  });
});
