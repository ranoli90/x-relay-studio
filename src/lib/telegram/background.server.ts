import { getSql } from "@/lib/db";
import { sessionReadyForBackgroundWatch, syncWatch } from "./watch.server.ts";

export type BackgroundTickResult = { watch: number; drained: number; jobs: number };

type DeskRow = {
  user_id: string;
  watching: boolean | null;
  has_session: boolean | null;
  auth_dead: boolean | null;
  emergency_stop: boolean | null;
  background_run: boolean | null;
};

/**
 * Tick desks that opted into background run, plus any tab-present desks.
 * Emergency stop skips the desk. Fair order is oldest last_sync first.
 */
export async function tickBackgroundDesks(
  limit = 8,
  extraUserIds: string[] = [],
): Promise<BackgroundTickResult> {
  const cap = Math.max(1, Math.min(Math.floor(limit) || 8, 32));
  const sql = await getSql();
  let desks: DeskRow[] = [];
  try {
    desks = await sql.query<DeskRow>(
      `select p.user_id,
              coalesce(bool_or(s.watching), false) as watching,
              bool_or(s.session_enc is not null) as has_session,
              coalesce(bool_or(s.auth_dead), false) as auth_dead,
              coalesce(bool_or(s.emergency_stop), bool_or(p.emergency_stop), false) as emergency_stop,
              coalesce(bool_or(p.background_run), false) as background_run
         from agent_personas p
         left join telegram_user_sessions s on s.user_id = p.user_id
        group by p.user_id
        order by min(s.last_sync_at) nulls first, p.user_id
        limit $1`,
      [Math.max(cap, extraUserIds.length + cap)],
    );
  } catch {
    desks = [];
  }

  const extras = extraUserIds.filter(Boolean);
  const selected = desks.filter((d) => {
    if (d.emergency_stop) return false;
    if (extras.includes(d.user_id)) return true;
    if (!d.background_run) return false;
    return sessionReadyForBackgroundWatch(d);
  }).slice(0, cap);

  let watch = 0;
  for (const desk of selected) {
    if (
      !sessionReadyForBackgroundWatch({
        watching: desk.watching,
        has_session: desk.has_session,
        auth_dead: desk.auth_dead,
        emergency_stop: desk.emergency_stop,
      })
    ) {
      continue;
    }
    try {
      await syncWatch(desk.user_id);
      watch += 1;
    } catch {
      /* persistMappedError already runs inside syncWatch; one desk must not stall the others */
    }
  }

  const userIds = [...new Set([...selected.map((d) => d.user_id), ...extras])];
  if (userIds.length === 0) return { watch, drained: 0, jobs: 0 };

  const { drainQueuedTelegram } = await import("@/lib/agent/ingest-telegram.server");
  const { tickAgentJobs } = await import("@/lib/agent/brain.server");
  const drained = await drainQueuedTelegram(cap, userIds);
  let jobs = 0;
  for (const id of userIds) {
    jobs += await tickAgentJobs(id);
  }
  return { watch, drained, jobs };
}
