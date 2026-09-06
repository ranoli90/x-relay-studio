/**
 * Secret-safe credential inventory.
 *
 * Classifies envelope *metadata* only: known prefix, part count, and length
 * bucket. Never decrypts. Never returns ciphertext, plaintext, tokens, or
 * the first segment of a non-envelope value (that segment may be the secret).
 *
 * Fail-closed decrypt in `src/lib/secrets.ts` / `vault.ts` stays. Inventory
 * is not a migration and does not restore plaintext fallback.
 */

export const ENVELOPE_KINDS = [
  "empty",
  "v1",
  "v2",
  "malformed_envelope",
  "non_envelope",
] as const;
export type EnvelopeKind = (typeof ENVELOPE_KINDS)[number];

export const LENGTH_BUCKETS = ["0", "1-32", "33-128", "129-512", "513+"] as const;
export type LengthBucket = (typeof LENGTH_BUCKETS)[number];

export type EnvelopeMetadata = {
  kind: EnvelopeKind;
  /** `v1` / `v2` when the first segment is a known envelope version; otherwise `none`. */
  prefix: "v1" | "v2" | "none";
  partCount: number;
  length: number;
  lengthBucket: LengthBucket;
};

export type InventoryCountRow = {
  source: string;
  kind: EnvelopeKind;
  prefix: "v1" | "v2" | "none";
  partCount: number;
  lengthBucket: LengthBucket;
  count: number;
};

export type CredentialInventorySummary = {
  dryRun: true;
  skipped: boolean;
  reason: string | null;
  scannedAt: string;
  sources: string[];
  totals: Record<EnvelopeKind, number>;
  bySource: Record<string, Record<EnvelopeKind, number>>;
  rows: InventoryCountRow[];
  duplicateIdentities: {
    redditIdGroups: number;
    extraRows: number;
  };
  reconnectRequired: {
    nonEnvelope: number;
    malformedEnvelope: number;
    empty: number;
  };
};

const EMPTY_TOTALS = (): Record<EnvelopeKind, number> => ({
  empty: 0,
  v1: 0,
  v2: 0,
  malformed_envelope: 0,
  non_envelope: 0,
});

export function lengthBucket(length: number): LengthBucket {
  if (length <= 0) return "0";
  if (length <= 32) return "1-32";
  if (length <= 128) return "33-128";
  if (length <= 512) return "129-512";
  return "513+";
}

/**
 * Inspect a stored blob without opening it.
 * The input is not copied onto the result.
 */
export function classifyEnvelopeMetadata(blob: string | null | undefined): EnvelopeMetadata {
  if (blob == null || blob === "") {
    return { kind: "empty", prefix: "none", partCount: 0, length: 0, lengthBucket: "0" };
  }
  const length = blob.length;
  const parts = blob.split(".");
  const partCount = parts.length;
  const head = parts[0];
  const prefix = head === "v1" || head === "v2" ? head : "none";
  let kind: EnvelopeKind;
  if (head === "v2" && partCount === 5) kind = "v2";
  else if (head === "v1" && partCount === 4) kind = "v1";
  else if (head === "v1" || head === "v2") kind = "malformed_envelope";
  else kind = "non_envelope";
  return { kind, prefix, partCount, length, lengthBucket: lengthBucket(length) };
}

/** SQL expression that classifies a column without selecting its value. */
export function envelopeKindSql(column: string): string {
  return `case
    when ${column} is null or ${column} = '' then 'empty'
    when split_part(${column}, '.', 1) = 'v2'
      and (length(${column}) - length(replace(${column}, '.', ''))) = 4 then 'v2'
    when split_part(${column}, '.', 1) = 'v1'
      and (length(${column}) - length(replace(${column}, '.', ''))) = 3 then 'v1'
    when split_part(${column}, '.', 1) in ('v1', 'v2') then 'malformed_envelope'
    else 'non_envelope'
  end`;
}

export function envelopePrefixSql(column: string): string {
  return `case
    when split_part(${column}, '.', 1) in ('v1', 'v2') then split_part(${column}, '.', 1)
    else 'none'
  end`;
}

export function envelopePartCountSql(column: string): string {
  return `case
    when ${column} is null or ${column} = '' then 0
    else length(${column}) - length(replace(${column}, '.', '')) + 1
  end`;
}

export function envelopeLengthBucketSql(column: string): string {
  return `case
    when ${column} is null or length(${column}) = 0 then '0'
    when length(${column}) <= 32 then '1-32'
    when length(${column}) <= 128 then '33-128'
    when length(${column}) <= 512 then '129-512'
    else '513+'
  end`;
}

export const INVENTORY_SOURCES: { source: string; table: string; column: string }[] = [
  { source: "reddit_apps.client_secret", table: "reddit_apps", column: "client_secret" },
  { source: "reddit_accounts.refresh_token", table: "reddit_accounts", column: "refresh_token" },
  { source: "reddit_accounts.access_token", table: "reddit_accounts", column: "access_token" },
  { source: "reddit_secret_entries.ciphertext", table: "reddit_secret_entries", column: "ciphertext" },
  {
    source: "reddit_cleanup_tasks.encrypted_revocation_material",
    table: "reddit_cleanup_tasks",
    column: "encrypted_revocation_material",
  },
  {
    source: "reddit_rejected_grants.encrypted_revocation_material",
    table: "reddit_rejected_grants",
    column: "encrypted_revocation_material",
  },
];

export function sourceInventorySql(table: string, column: string, source: string): string {
  return `select
    '${source}' as source,
    ${envelopeKindSql(column)} as kind,
    ${envelopePrefixSql(column)} as prefix,
    ${envelopePartCountSql(column)} as part_count,
    ${envelopeLengthBucketSql(column)} as length_bucket,
    count(*)::int as count
  from ${table}
  group by 2, 3, 4, 5`;
}

export function duplicateIdentitySql(): string {
  return `select count(*)::int as groups,
          coalesce(sum(n - 1), 0)::int as extra_rows
     from (
       select reddit_id, count(*)::int as n
         from reddit_accounts
        group by reddit_id
       having count(*) > 1
     ) d`;
}

export function emptyInventorySummary(reason: string, skipped: boolean): CredentialInventorySummary {
  return {
    dryRun: true,
    skipped,
    reason,
    scannedAt: new Date().toISOString(),
    sources: INVENTORY_SOURCES.map((s) => s.source),
    totals: EMPTY_TOTALS(),
    bySource: {},
    rows: [],
    duplicateIdentities: { redditIdGroups: 0, extraRows: 0 },
    reconnectRequired: { nonEnvelope: 0, malformedEnvelope: 0, empty: 0 },
  };
}

export function assembleInventorySummary(
  counts: InventoryCountRow[],
  duplicates: { redditIdGroups: number; extraRows: number },
): CredentialInventorySummary {
  const totals = EMPTY_TOTALS();
  const bySource: Record<string, Record<EnvelopeKind, number>> = {};
  for (const row of counts) {
    totals[row.kind] += row.count;
    bySource[row.source] ??= EMPTY_TOTALS();
    bySource[row.source][row.kind] += row.count;
  }
  return {
    dryRun: true,
    skipped: false,
    reason: null,
    scannedAt: new Date().toISOString(),
    sources: INVENTORY_SOURCES.map((s) => s.source),
    totals,
    bySource,
    rows: counts,
    duplicateIdentities: duplicates,
    reconnectRequired: {
      nonEnvelope: totals.non_envelope,
      malformedEnvelope: totals.malformed_envelope,
      empty: totals.empty,
    },
  };
}

/** Guard: summary JSON must never contain a raw envelope or obvious token. */
export function summaryLooksSafe(summary: CredentialInventorySummary): boolean {
  const text = JSON.stringify(summary);
  if (/\bv[12]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(text)) return false;
  if (/refresh_token|access_token|client_secret/i.test(text) && /"[A-Za-z0-9_-]{20,}"/.test(text)) {
    return false;
  }
  return true;
}

export async function inventoryFromQuery(
  query: <T>(text: string) => Promise<T[]>,
): Promise<CredentialInventorySummary> {
  const counts: InventoryCountRow[] = [];
  for (const source of INVENTORY_SOURCES) {
    try {
      const rows = await query<{
        source: string;
        kind: EnvelopeKind;
        prefix: "v1" | "v2" | "none";
        part_count: number;
        length_bucket: LengthBucket;
        count: number;
      }>(sourceInventorySql(source.table, source.column, source.source));
      for (const row of rows) {
        counts.push({
          source: row.source,
          kind: row.kind,
          prefix: row.prefix,
          partCount: Number(row.part_count),
          lengthBucket: row.length_bucket,
          count: Number(row.count),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/does not exist|undefined table|relation .* does not exist/i.test(message)) {
        continue;
      }
      throw err;
    }
  }
  let duplicates = { redditIdGroups: 0, extraRows: 0 };
  try {
    const dupRows = await query<{ groups: number; extra_rows: number }>(duplicateIdentitySql());
    duplicates = {
      redditIdGroups: Number(dupRows[0]?.groups ?? 0),
      extraRows: Number(dupRows[0]?.extra_rows ?? 0),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/does not exist|undefined table|relation .* does not exist/i.test(message)) throw err;
  }
  return assembleInventorySummary(counts, duplicates);
}
