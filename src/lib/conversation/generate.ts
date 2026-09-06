export type SafeErrorClass =
  | "missing_key"
  | "unauthorized"
  | "payment_required"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "empty"
  | "truncated"
  | "refusal"
  | "malformed"
  | "validator_rejected"
  | "unknown";

export function classifyHttpStatus(status: number): SafeErrorClass {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "payment_required";
  if (status === 429) return "rate_limited";
  if (status === 503 || status === 502 || status === 500) return "unavailable";
  if (status === 404) return "unavailable";
  return "unknown";
}

export function classifyFinishReason(reason: string | null | undefined, text: string): SafeErrorClass | null {
  const r = (reason ?? "").toLowerCase();
  if (r === "length" || r === "max_tokens") return "truncated";
  if (r === "content_filter" || r === "refusal") return "refusal";
  if (!text.trim()) return "empty";
  return null;
}

export type GenerationHealth =
  | "unconfigured"
  | "configured"
  | "authenticated"
  | "route_capable"
  | "recently_generated"
  | "degraded";

export function combineHealth(opts: {
  configured: boolean;
  lastAuthOk: boolean | null;
  lastGenerationOk: boolean | null;
  lastGenerationAt: number | null;
  now?: number;
}): GenerationHealth {
  if (!opts.configured) return "unconfigured";
  if (opts.lastAuthOk === false) return "degraded";
  if (opts.lastGenerationOk === false) return "degraded";
  const now = opts.now ?? Date.now();
  if (opts.lastGenerationOk && opts.lastGenerationAt && now - opts.lastGenerationAt < 30 * 60_000) {
    return "recently_generated";
  }
  if (opts.lastAuthOk) return "authenticated";
  return "configured";
}
