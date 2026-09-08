import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyLiveArmSql } from "./arm.ts";

function toSql(pg: PGlite) {
  return {
    query: async <T>(text: string, params: unknown[] = []) => {
      const res = await pg.query<T>(text, params);
      return res.rows;
    },
  };
}

describe("live autopilot arming", () => {
  it("arms personas and live sessions, and skips emergency-stopped desks", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
      create table agent_personas (
        user_id text primary key,
        auto_send boolean not null default false,
        background_run boolean not null default false,
        processing_permission boolean not null default false,
        desired_auto_reply boolean not null default false,
        automation_mode text not null default 'draft',
        emergency_stop boolean not null default false
      );
      create table telegram_user_sessions (
        user_id text primary key,
        session_enc text,
        watching boolean not null default false,
        automation_armed boolean not null default false,
        auth_dead boolean not null default false,
        emergency_stop boolean not null default false,
        updated_at timestamptz
      );
      insert into agent_personas values
        ('desk_live', false, false, false, false, 'draft', false),
        ('desk_stop', false, false, false, false, 'draft', true);
      insert into telegram_user_sessions values
        ('desk_live', 'sess', false, false, false, false, now()),
        ('desk_stop', 'sess', false, false, false, true, now());
    `);
    const sql = toSql(pg);
    await applyLiveArmSql("desk_live", sql);
    await applyLiveArmSql("desk_stop", sql);

    const live = (
      await pg.query<{
        auto_send: boolean;
        processing_permission: boolean;
        automation_mode: string;
      }>(`select auto_send, processing_permission, automation_mode from agent_personas where user_id = 'desk_live'`)
    ).rows[0]!;
    assert.equal(live.auto_send, true);
    assert.equal(live.processing_permission, true);
    assert.equal(live.automation_mode, "approved_auto");

    const stopped = (
      await pg.query<{ auto_send: boolean; automation_mode: string }>(
        `select auto_send, automation_mode from agent_personas where user_id = 'desk_stop'`,
      )
    ).rows[0]!;
    assert.equal(stopped.auto_send, false);
    assert.equal(stopped.automation_mode, "draft");

    const watch = (
      await pg.query<{ watching: boolean; automation_armed: boolean }>(
        `select watching, automation_armed from telegram_user_sessions where user_id = 'desk_live'`,
      )
    ).rows[0]!;
    assert.equal(watch.watching, true);
    assert.equal(watch.automation_armed, true);

    const stopWatch = (
      await pg.query<{ watching: boolean; automation_armed: boolean }>(
        `select watching, automation_armed from telegram_user_sessions where user_id = 'desk_stop'`,
      )
    ).rows[0]!;
    assert.equal(stopWatch.watching, false);
    assert.equal(stopWatch.automation_armed, false);
    await pg.close();
  });
});
