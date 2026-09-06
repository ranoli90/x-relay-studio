import type { SqlLike } from "./sql.ts";
import { countConnectedAccounts } from "./store.ts";

export async function recordOwnerGateReceipt(
  sql: SqlLike,
  userId: string,
  source: "fixture" | "live" = "fixture",
): Promise<void> {
  await sql.query(
    `insert into reddit_owner_gate_receipts (user_id, source, completed_at)
     values ($1, $2, now())
     on conflict (user_id) do nothing`,
    [userId, source],
  );
}

export async function ownerKicksAlreadyDone(sql: SqlLike, userId: string): Promise<boolean> {
  const receipt = await sql.query<{ user_id: string }>(
    `select user_id from reddit_owner_gate_receipts where user_id = $1 limit 1`,
    [userId],
  );
  if (receipt[0]) return true;
  return (await countConnectedAccounts(sql, userId)) > 0;
}
