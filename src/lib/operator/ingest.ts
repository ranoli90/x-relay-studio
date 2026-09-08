/** Bounded fair ingest. Do not raise poll rate to "catch up". */

export type IngestCursor = {
  conversationId: string;
  lastProviderAt: string | null;
  lastAttemptAt: number;
  nextEligibleAt: number;
  errorCount: number;
};

export const INGEST_BATCH = 4;
export const INGEST_BASE_BACKOFF_MS = 15_000;
export const INGEST_MAX_BACKOFF_MS = 15 * 60_000;

export function nextIngestBatch(
  cursors: IngestCursor[],
  now: number,
  batchSize = INGEST_BATCH,
): IngestCursor[] {
  const due = cursors
    .filter((c) => c.nextEligibleAt <= now)
    .sort((a, b) => {
      const ta = a.lastAttemptAt - b.lastAttemptAt;
      if (ta !== 0) return ta;
      return a.conversationId.localeCompare(b.conversationId);
    });
  return due.slice(0, Math.max(1, batchSize));
}

export function backoffMs(errorCount: number): number {
  const n = Math.max(0, errorCount);
  const raw = INGEST_BASE_BACKOFF_MS * 2 ** Math.min(n, 6);
  return Math.min(INGEST_MAX_BACKOFF_MS, raw);
}

export function markIngestAttempt(
  cursor: IngestCursor,
  now: number,
  ok: boolean,
  providerMinIntervalMs = INGEST_BASE_BACKOFF_MS,
): IngestCursor {
  if (ok) {
    return {
      ...cursor,
      lastAttemptAt: now,
      nextEligibleAt: now + providerMinIntervalMs,
      errorCount: 0,
    };
  }
  const errors = cursor.errorCount + 1;
  return {
    ...cursor,
    lastAttemptAt: now,
    nextEligibleAt: now + backoffMs(errors),
    errorCount: errors,
  };
}

/** Every eligible chat is visited under a bounded batch — none starved forever. */
export function fairnessRoundsToCover(chatCount: number, batchSize = INGEST_BATCH): number {
  if (chatCount <= 0) return 0;
  return Math.ceil(chatCount / Math.max(1, batchSize));
}
