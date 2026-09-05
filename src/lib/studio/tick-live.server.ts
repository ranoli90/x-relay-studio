import { getSql } from "@/lib/db";
import { tickLiveForUser } from "@/lib/studio/drip.server";

/** Cron entry: tick drip-enabled publishers across desks. */
export async function tickLiveAll(limit = 4): Promise<{ userId: string; watch: number; queued: number }[]> {
  const sql = await getSql();
  const pubs = await sql<{ user_id: string }>`
    select distinct user_id
    from publishers
    where drip_enabled = true
    limit ${Math.max(1, Math.min(limit, 16))}
  `;
  const out: { userId: string; watch: number; queued: number }[] = [];
  for (const row of pubs) {
    try {
      const result = await tickLiveForUser(row.user_id);
      out.push({ userId: row.user_id, ...result });
    } catch (err) {
      console.info("[studio]", {
        event: "tick_live_user_failed",
        message: err instanceof Error ? err.message.slice(0, 160) : "fail",
      });
    }
  }
  return out;
}
