import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { generateDeskNumber, isDeskNumber, normalizeDeskNumber } from "./number";

export type DeskPublic = {
  deskNumber: string;
  createdAt: string;
};

export const getDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{ desk_number: string; created_at: string | Date }>`
      select desk_number, created_at from desks where user_id = ${context.userId} limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      deskNumber: row.desk_number,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    } satisfies DeskPublic;
  });

export const openDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { deskNumber?: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await sql<{ desk_number: string; created_at: string | Date }>`
      select desk_number, created_at from desks where user_id = ${context.userId} limit 1
    `;
    if (existing[0]) {
      const row = existing[0];
      return {
        deskNumber: row.desk_number,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      } satisfies DeskPublic;
    }

    let number = data.deskNumber ? normalizeDeskNumber(data.deskNumber) : generateDeskNumber();
    if (!isDeskNumber(number)) number = generateDeskNumber();

    for (let i = 0; i < 5; i += 1) {
      const clash = await sql<{ user_id: string }>`
        select user_id from desks where desk_number = ${number} limit 1
      `;
      if (clash.length === 0) break;
      number = generateDeskNumber();
    }

    await sql`
      insert into desks (user_id, desk_number) values (${context.userId}, ${number})
    `;
    return { deskNumber: number, createdAt: new Date().toISOString() } satisfies DeskPublic;
  });
