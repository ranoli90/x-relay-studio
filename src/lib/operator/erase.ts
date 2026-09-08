/** Derived-data deletion inventory. Disconnect must cover every operator table. */

export const OPERATOR_ERASE_TABLES = [
  "memory_facts",
  "operator_quotes",
  "payment_evidence",
  "payment_credentials",
  "payment_destinations",
  "payment_instructions",
  "media_proposals",
  "incoming_attachments",
  "media_assets",
  "composer_drafts",
  "conversation_read_acks",
  "send_attempts",
  "ingest_cursors",
  "business_offers",
  "business_revisions",
  "business_briefs",
  "operator_bindings",
] as const;

export type EraseTable = (typeof OPERATOR_ERASE_TABLES)[number];

export function eraseStatements(userIdParam = "$1"): Array<{ table: EraseTable; sql: string }> {
  return OPERATOR_ERASE_TABLES.map((table) => ({
    table,
    sql: `delete from ${table} where user_id = ${userIdParam}`,
  }));
}

export function cannotRehydrateFrom(table: EraseTable): boolean {
  return OPERATOR_ERASE_TABLES.includes(table);
}
