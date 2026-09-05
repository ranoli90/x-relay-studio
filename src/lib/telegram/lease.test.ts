import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  claimMtprotoLease,
  releaseMtprotoLease,
  renewMtprotoLease,
  seizeSessionGeneration,
  sessionGeneration,
  wipeDisconnectedSession,
} from "./lease.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

async function boot() {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    create table telegram_user_sessions (
      user_id text primary key,
      lease_until timestamptz,
      lease_owner text,
      account_generation integer not null default 1,
      session_enc text,
      phone_code_hash_enc text,
      api_hash_enc text not null default 'x',
      phone text not null default '+1',
      watching boolean not null default false,
      automation_armed boolean not null default false,
      auth_dead boolean not null default false,
      flood_until timestamptz,
      onboarded_at timestamptz,
      last_error text,
      last_sync_at timestamptz,
      last_sync_ok_at timestamptz,
      checks_json text,
      updated_at timestamptz
    );
    insert into telegram_user_sessions
      (user_id, lease_until, lease_owner, account_generation, session_enc, watching, updated_at)
      values ('u1', null, null, 1, 'sess', true, now());
  `);
  return pg;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("F14 lease owner", () => {
  it("a stale owner cannot clear a newer lease", async () => {
    const pg = await boot();
    const sql = toSql(pg);
    const claimed = await claimMtprotoLease(sql, "u1", "lease_live", 25);
    assert.ok(claimed);
    assert.equal(await releaseMtprotoLease(sql, "u1", "lease_old_mismatch"), false);
    const row = (
      await pg.query<{ lease_owner: string }>(`select lease_owner from telegram_user_sessions`)
    ).rows[0];
    assert.equal(row.lease_owner, "lease_live");
    assert.equal(await releaseMtprotoLease(sql, "u1", "lease_live"), true);
    await pg.close();
  });

  it("renews while the owner matches and refuses a stale owner", async () => {
    const pg = await boot();
    const sql = toSql(pg);
    const claimed = await claimMtprotoLease(sql, "u1", "lease_a", 1);
    assert.ok(claimed);
    assert.equal(claimed.generation, 1);

    await sleep(50);
    const renewed = await renewMtprotoLease(sql, "u1", "lease_a", 1, 2);
    assert.equal(renewed, true);

    const staleRenew = await renewMtprotoLease(sql, "u1", "lease_old", 1, 2);
    assert.equal(staleRenew, false);

    const still = (
      await pg.query<{ lease_owner: string }>(`select lease_owner from telegram_user_sessions`)
    ).rows[0];
    assert.equal(still.lease_owner, "lease_a");

    const staleRelease = await releaseMtprotoLease(sql, "u1", "lease_old");
    assert.equal(staleRelease, false);
    const liveRelease = await releaseMtprotoLease(sql, "u1", "lease_a");
    assert.equal(liveRelease, true);
    await pg.close();
  });

  it("work past the original 25s window stays owned only when renewed", async () => {
    const pg = await boot();
    const sql = toSql(pg);
    const first = await claimMtprotoLease(sql, "u1", "lease_ttl", 1);
    assert.ok(first);
    await sleep(1100);
    const stolen = await claimMtprotoLease(sql, "u1", "lease_other", 1);
    assert.ok(stolen);
    assert.equal(stolen.owner, "lease_other");
    assert.equal(await releaseMtprotoLease(sql, "u1", "lease_ttl"), false);
    assert.equal(await releaseMtprotoLease(sql, "u1", "lease_other"), true);

    const held = await claimMtprotoLease(sql, "u1", "lease_hold", 1);
    assert.ok(held);
    assert.equal(await renewMtprotoLease(sql, "u1", "lease_hold", 1, 2), true);
    await sleep(1100);
    const blocked = await claimMtprotoLease(sql, "u1", "lease_thief", 1);
    assert.equal(blocked, null);
    const owner = (
      await pg.query<{ lease_owner: string }>(`select lease_owner from telegram_user_sessions`)
    ).rows[0];
    assert.equal(owner.lease_owner, "lease_hold");
    await pg.close();
  });
});

describe("F21 unlink generation", () => {
  it("bumps generation so an old lease cannot renew or write", async () => {
    const pg = await boot();
    const sql = toSql(pg);
    const claimed = await claimMtprotoLease(sql, "u1", "lease_a", 25);
    assert.ok(claimed);

    const nextGen = await seizeSessionGeneration(sql, "u1");
    assert.equal(nextGen, 2);
    assert.equal(await wipeDisconnectedSession(sql, "u1", "[]"), true);

    assert.equal(await sessionGeneration(sql, "u1"), 2);
    assert.equal(await renewMtprotoLease(sql, "u1", "lease_a", 1, 25), false);
    assert.equal(await releaseMtprotoLease(sql, "u1", "lease_a"), false);

    const write = await pg.query(
      `update telegram_user_sessions
          set session_enc = $2
        where user_id = $1 and coalesce(account_generation, 1) = $3
        returning user_id`,
      ["u1", "stolen", 1],
    );
    assert.equal(write.rows.length, 0);
    const row = (
      await pg.query<{
        session_enc: string | null;
        account_generation: number;
        watching: boolean;
        lease_owner: string | null;
      }>(`select session_enc, account_generation, watching, lease_owner from telegram_user_sessions`)
    ).rows[0];
    assert.equal(row.session_enc, null);
    assert.equal(row.account_generation, 2);
    assert.equal(row.watching, false);
    assert.equal(row.lease_owner, null);
    await pg.close();
  });
});

describe("F12 last-success vs last-attempt", () => {
  it("a failed sync keeps last_sync_ok_at", async () => {
    const pg = await boot();
    await pg.query(
      `update telegram_user_sessions
          set last_sync_at = now() - interval '1 minute',
              last_sync_ok_at = now() - interval '1 minute'
        where user_id = $1`,
      ["u1"],
    );
    const ok = (
      await pg.query<{ last_sync_ok_at: string }>(`select last_sync_ok_at from telegram_user_sessions`)
    ).rows[0];
    assert.ok(ok.last_sync_ok_at);
    await pg.query(
      `update telegram_user_sessions
          set last_sync_at = now(),
              last_sync_ok_at = case when $2 then now() else last_sync_ok_at end
        where user_id = $1`,
      ["u1", false],
    );
    const after = (
      await pg.query<{ last_sync_at: string; last_sync_ok_at: string }>(
        `select last_sync_at, last_sync_ok_at from telegram_user_sessions`,
      )
    ).rows[0];
    assert.equal(String(after.last_sync_ok_at), String(ok.last_sync_ok_at));
    assert.ok(new Date(after.last_sync_at).getTime() > new Date(after.last_sync_ok_at).getTime());
    await pg.close();
  });
});
