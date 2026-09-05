import { getSql } from "@/lib/db";
import { newId } from "./ids.ts";
import type { ActivityKind, DeskActivity } from "./types.ts";

type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function iso(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

export async function recordActivity(
  sql: Sql,
  row: {
    userId: string;
    personaId?: string | null;
    threadId?: string | null;
    agentName?: string | null;
    kind: ActivityKind;
    body?: string | null;
  },
): Promise<void> {
  await sql.query(
    `insert into agent_activity (id, user_id, persona_id, thread_id, agent_name, kind, body)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId("act"),
      row.userId,
      row.personaId ?? null,
      row.threadId ?? null,
      row.agentName ?? null,
      row.kind,
      row.body ?? null,
    ],
  );
}

export async function listActivity(userId: string, limit = 40): Promise<DeskActivity[]> {
  const sql = await getSql();
  const rows = await sql.query<{
    id: string;
    agent_name: string | null;
    kind: string;
    body: string | null;
    thread_id: string | null;
    created_at: string | Date;
  }>(
    `select id, agent_name, kind, body, thread_id, created_at
       from agent_activity
      where user_id = $1
      order by created_at desc
      limit $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    agentName: r.agent_name ?? "",
    kind: r.kind,
    body: r.body ?? "",
    threadId: r.thread_id,
    createdAt: iso(r.created_at) ?? "",
  }));
}
