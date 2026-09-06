/** Operator/schema copy that must not appear on BindDesk. */
const SCHEMA_RETRY =
  /schema is behind|schema is missing|_migrations|db:migrate|not applied|timed out|timeout|504|503/i;

export const DESK_STARTING = "The desk is still starting. Wait a few seconds and try again.";

/** Map server failures to copy a signed-in visitor can act on. */
export function publicDeskError(err: unknown, fallback = "Could not open a desk."): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (SCHEMA_RETRY.test(raw)) return DESK_STARTING;
  const trimmed = raw.trim();
  return trimmed || fallback;
}
