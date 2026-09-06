/** Exhaustive transport results. Only a confirmed acknowledgment is sent. */

export type DispatchOutcome =
  | { kind: "sent_confirmed"; transportMessageId: string; acknowledgedAt: string }
  | { kind: "blocked"; reason: string }
  | { kind: "canceled_stale"; reason: string }
  | { kind: "failed_definitive"; reason: string; retryable: boolean }
  | { kind: "uncertain"; reason: string }
  | { kind: "not_live"; reason: string }
  | { kind: "local"; reason: string };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function isNotLiveText(s: string): boolean {
  return /not_live|skipped|preview|unlinked|auth_dead|chat_not_found|not onboarded/i.test(s);
}

export function classifyTransportResult(value: unknown, err?: unknown): DispatchOutcome {
  if (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNotLiveText(msg)) return { kind: "not_live", reason: msg.slice(0, 240) };
    if (/uncertain/i.test(msg)) return { kind: "uncertain", reason: msg.slice(0, 240) };
    return { kind: "failed_definitive", reason: msg.slice(0, 240), retryable: /flood|429|503|timeout/i.test(msg) };
  }
  if (value == null || value === true || value === false) {
    return { kind: "uncertain", reason: value == null ? "null_result" : "boolean_result" };
  }
  const rec = asRecord(value);
  if (!rec) return { kind: "uncertain", reason: "unparseable" };

  const status = String(rec.status ?? rec.reason ?? rec.code ?? "");
  const transportId = rec.telegramMessageId ?? rec.transportMessageId ?? rec.messageId;
  const id = transportId == null || transportId === "" ? null : String(transportId);

  if (isNotLiveText(status) || rec.status === "not_live") {
    return { kind: "not_live", reason: status || "not_live" };
  }
  if (rec.ok === false) {
    const reason = String(rec.reason ?? rec.error ?? "dispatch failed").slice(0, 240);
    if (isNotLiveText(reason)) return { kind: "not_live", reason };
    if (/uncertain/i.test(reason)) return { kind: "uncertain", reason };
    return { kind: "failed_definitive", reason, retryable: false };
  }
  if (/fail|error/i.test(status) && !/ok|sent/i.test(status)) {
    return { kind: "failed_definitive", reason: String(rec.error ?? rec.reason ?? status).slice(0, 240), retryable: false };
  }
  if ((rec.ok === true || /ok|sent/i.test(status)) && id) {
    return {
      kind: "sent_confirmed",
      transportMessageId: id,
      acknowledgedAt: new Date().toISOString(),
    };
  }
  if (rec.ok === true || /ok|sent/i.test(status)) {
    return { kind: "uncertain", reason: "ok_without_ack_id" };
  }
  return { kind: "uncertain", reason: status || "unknown_shape" };
}

export function isSentConfirmed(outcome: DispatchOutcome): outcome is Extract<DispatchOutcome, { kind: "sent_confirmed" }> {
  return outcome.kind === "sent_confirmed";
}

export type IdempotencyRow = {
  status?: string | null;
  result_json?: string | null;
  thread_id?: string | null;
  lease_until?: string | Date | null;
};

export type IdempotencyHit =
  | { action: "replay"; result: Record<string, unknown> }
  | { action: "in_flight" }
  | { action: "reclaim" }
  | { action: "hold" };

/**
 * Crash-after-claim is recoverable: a completed result is replayed, a live
 * lease is in-flight, an expired claim is reclaimed, anything else holds.
 */
export function resolveIdempotencyHit(existing: IdempotencyRow, now = Date.now()): IdempotencyHit {
  if (existing.result_json) {
    try {
      const parsed = JSON.parse(existing.result_json) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && typeof parsed.threadId === "string" && parsed.threadId) {
        return { action: "replay", result: parsed };
      }
    } catch {
      /* fall through */
    }
  }
  if (existing.status === "completed") return { action: "hold" };
  const claimed = existing.status === "claimed" || existing.status == null || existing.status === "";
  if (claimed) {
    const lease = existing.lease_until ? new Date(existing.lease_until).getTime() : 0;
    if (Number.isFinite(lease) && lease > now) return { action: "in_flight" };
    return { action: "reclaim" };
  }
  return { action: "hold" };
}
