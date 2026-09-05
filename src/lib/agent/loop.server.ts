/** Server-only background loop. Tab close must not stop `background_run` desks. */

const INTERVAL_MS = 20_000;
const PRESENCE_MS = 90_000;
const FLAG = "__xrelayAgentLoop";
const PRESENCE = "__xrelayDeskPresence";

type LoopGlobal = typeof globalThis & {
  [FLAG]?: ReturnType<typeof setInterval> | true;
  [PRESENCE]?: Map<string, number>;
};

function presenceMap(): Map<string, number> {
  const g = globalThis as LoopGlobal;
  if (!g[PRESENCE]) g[PRESENCE] = new Map();
  return g[PRESENCE];
}

/** Floor poll / settings keep this desk in the in-process drain while the tab is open. */
export function markDeskPresent(userId: string): void {
  if (!userId) return;
  presenceMap().set(userId, Date.now());
}

export function presentUserIds(now = Date.now()): string[] {
  const map = presenceMap();
  const ids: string[] = [];
  for (const [id, at] of map) {
    if (now - at < PRESENCE_MS) ids.push(id);
    else map.delete(id);
  }
  return ids;
}

export async function tickAutoSendOnce(limit = 8) {
  const { tickBackgroundDesks } = await import("@/lib/telegram/background.server");
  return tickBackgroundDesks(limit, presentUserIds());
}

/**
 * Start an in-process interval (dev / sandbox). Vercel isolates skip this —
 * production relies on `/api/cron/studio`. Safe to call from many requests.
 */
export function ensureAgentLoop(): void {
  if (process.env.VERCEL) return;
  const g = globalThis as LoopGlobal;
  if (g[FLAG]) return;
  g[FLAG] = true;

  const run = () => {
    void (async () => {
      try {
        const { withCronLock } = await import("@/lib/jobs/lock");
        await withCronLock(async () => {
          await tickAutoSendOnce();
        });
      } catch {
        /* next interval retries; never log session bytes */
      }
    })();
  };

  const timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
  const kick = setTimeout(run, 1_000);
  kick.unref?.();
  g[FLAG] = timer;
}
