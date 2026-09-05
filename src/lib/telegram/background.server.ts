import { getSql } from "@/lib/db";
import { sessionReadyForBackgroundWatch, syncWatch } from "./watch.server.ts";

export type BackgroundTickResult = { watch: number; drained: number; jobs: number };

type DeskRow = {
  user_id: string;
  watching: boolean | null;
  has_session: boolean | null;
  auth_dead: boolean | null;
};

/**
 * For desks with `agent_personas.background_run`: pull inbox if watching and
 * live. Drain + jobs run for those desks plus any tab-present desks (so
 * auto-send still fires while the floor is open). Tab close without
 * background_run ages presence out.
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
              coalesce(bool_or(s.auth_dead), false) as auth_dead
         from agent_personas p
         left join telegram_user_sessions s on s.user_id = p.user_id
        where p.background_run = true
        group by p.user_id
        order by p.user_id
        limit $1`,
      [cap],
    );
  } catch {
    desks = [];
  }

  let watch = 0;
  for (const desk of desks) {
    if (
      !sessionReadyForBackgroundWatch({
        watching: desk.watching,
        has_session: desk.has_session,
        auth_dead: desk.auth_dead,
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

  const userIds = [...new Set([...desks.map((d) => d.user_id), ...extraUserIds.filter(Boolean)])];
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
