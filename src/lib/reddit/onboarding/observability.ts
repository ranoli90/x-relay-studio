const SENSITIVE =
  /password|passwd|secret|token|cookie|authorization|otp|verification.code|refresh_token|access_token|cdp|connectUrl|liveView/i;

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (SENSITIVE.test(value)) return "[redacted]";
    if (value.length > 400) return value.slice(0, 400);
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : redactValue(v);
    }
    return out;
  }
  return value;
}

export function safeError(code: string, summary: string) {
  return { code, summary: summary.slice(0, 180) };
}

export const SAFE_EVENT_TYPES = [
  "job_created",
  "details_saved",
  "started",
  "session_allocation_requested",
  "session_allocation_confirmed",
  "step_started",
  "step_completed",
  "user_action_required",
  "control_granted",
  "control_ended",
  "submit_intent_created",
  "result_unknown",
  "identity_verified",
  "oauth_started",
  "oauth_denied",
  "oauth_completed",
  "wrong_identity",
  "connection_finalized",
  "cancelled",
  "cleanup_queued",
  "cleanup_retry",
  "cleanup_completed",
  "retention_expiry",
  "unsupported_page",
] as const;

export type SafeEventType = (typeof SAFE_EVENT_TYPES)[number];
