import { getSql } from "@/lib/db";
import { studioTickEnabled } from "@/lib/flags";
import { fairSelect } from "@/lib/studio/integrity";
import { tickLiveForUser } from "@/lib/studio/drip.server";

/** Cron entry: tick drip-enabled publishers across desks with tenant fairness. */
export async function tickLiveAll(limit = 4): Promise<{ userId: string; watch: number; queued: number }[]> {
  if (!studioTickEnabled()) return [];
  const sql = await getSql();
  const cap = Math.max(1, Math.min(limit, 16));
  let pubs: { user_id: string }[] = [];
  try {
    pubs = await sql<{ user_id: string }>`
      select user_id from (
        select user_id,
          min(least(
            coalesce(last_original_at, '1970-01-01'::timestamptz),
            coalesce(last_reply_at, '1970-01-01'::timestamptz),
            coalesce(last_quote_at, '1970-01-01'::timestamptz)
          )) as last_work
        from publishers
        where drip_enabled = true
        group by user_id
      ) t
      order by last_work asc
      limit ${cap * 4}
    `;
  } catch {
    pubs = await sql<{ user_id: string }>`
      select distinct user_id
      from publishers
      where drip_enabled = true
      order by user_id
      limit ${cap * 4}
    `;
  }
  const fair = fairSelect(pubs, cap);
  const out: { userId: string; watch: number; queued: number }[] = [];
  for (const row of fair) {
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
