import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { generateDeskNumber, isDeskNumber, normalizeDeskNumber } from "./number";

export type DeskPublic = {
  deskNumber: string;
  createdAt: string;
};

function asPublic(row: { desk_number: string; created_at: string | Date }): DeskPublic {
  return {
    deskNumber: row.desk_number,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export const getDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{ desk_number: string; created_at: string | Date }>`
      select desk_number, created_at from desks where user_id = ${context.userId} limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return asPublic(row);
  });

export const openDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { deskNumber?: string; restore?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await sql<{ desk_number: string; created_at: string | Date }>`
      select desk_number, created_at from desks where user_id = ${context.userId} limit 1
    `;

    const requested = data.deskNumber ? normalizeDeskNumber(data.deskNumber) : "";
    if (requested && !isDeskNumber(requested)) {
      throw new Error("A desk number is 16 digits.");
    }

    if (existing[0]) {
      if (requested && existing[0].desk_number !== requested) {
        throw new Error("This session already belongs to a different desk.");
      }
      return asPublic(existing[0]);
    }

    if (data.restore) {
      if (!requested) throw new Error("Enter the 16-digit desk number to return.");
      const owner = await sql<{ user_id: string }>`
        select user_id from desks where desk_number = ${requested} limit 1
      `;
      if (owner[0] && owner[0].user_id !== context.userId) {
        throw new Error("No desk with that number.");
      }
      if (owner[0]) {
        const row = await sql<{ desk_number: string; created_at: string | Date }>`
          select desk_number, created_at from desks where user_id = ${context.userId} limit 1
        `;
        if (row[0]) return asPublic(row[0]);
      }
      await sql`
        insert into desks (user_id, desk_number) values (${context.userId}, ${requested})
      `;
      return { deskNumber: requested, createdAt: new Date().toISOString() } satisfies DeskPublic;
    }

    let number = requested && isDeskNumber(requested) ? requested : generateDeskNumber();

    for (let i = 0; i < 8; i += 1) {
      const clash = await sql<{ user_id: string }>`
        select user_id from desks where desk_number = ${number} limit 1
      `;
      if (clash.length > 0) {
        if (requested) {
          throw new Error("That desk number is already taken. Open a new desk instead.");
        }
        number = generateDeskNumber();
        continue;
      }
      try {
        await sql`
          insert into desks (user_id, desk_number) values (${context.userId}, ${number})
        `;
        return { deskNumber: number, createdAt: new Date().toISOString() } satisfies DeskPublic;
      } catch {
        const raced = await sql<{ desk_number: string; created_at: string | Date }>`
          select desk_number, created_at from desks where user_id = ${context.userId} limit 1
        `;
        if (raced[0]) return asPublic(raced[0]);
        if (requested) {
          throw new Error("That desk number is already taken. Open a new desk instead.");
        }
        number = generateDeskNumber();
      }
    }
    throw new Error("Could not open a desk. Try again.");
  });
