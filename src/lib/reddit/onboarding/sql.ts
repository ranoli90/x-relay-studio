export type SqlLike = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function withSqlTransaction<T>(
  sql: SqlLike,
  fn: (sql: SqlLike) => Promise<T>,
  begin = true,
): Promise<T> {
  if (!begin) return fn(sql);
  await sql.query("begin");
  try {
    const result = await fn(sql);
    await sql.query("commit");
    return result;
  } catch (err) {
    try {
      await sql.query("rollback");
    } catch {
      /* keep original */
    }
    throw err;
  }
}
