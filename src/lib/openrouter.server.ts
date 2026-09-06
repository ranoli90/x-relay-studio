import {
  classifyFinishReason,
  classifyHttpStatus,
  combineHealth,
  healthIsReady,
  remainingDeadlineMs,
  unusableFinish,
  type GenerationHealth,
  type SafeErrorClass,
} from "./conversation/generate.ts";

/**
 * OpenRouter is locked in — the key never leaves the server and is never
 * asked for in the UI. Production fails closed if OPENROUTER_API_KEY is missing.
 *
 * `openRouterConfigured()` is only a nonempty key string (not a usable writer).
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_MODEL = "x-ai/grok-4.6";
const FALLBACK_MODELS = ["x-ai/grok-4.5", "x-ai/grok-4.3"];
const DEFAULT_DEADLINE_MS = 55_000;

function apiKey(): string {
  return process.env.OPENROUTER_API_KEY?.trim() ?? "";
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  web?: boolean;
  timeoutMs?: number;
  /** End-to-end deadline across model fallbacks. Not multiplied per model. */
  deadlineMs?: number;
  xFilter?: {
    allowed_x_handles?: string[];
    from_date?: string;
    to_date?: string;
  };
  /** Own the route table. Never pass openrouter/auto. */
  models?: string[];
  providerSort?: "price" | "throughput";
};

export type ChatResult = {
  text: string;
  model: string;
  finishReason?: string | null;
  generationId?: string | null;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  safeError?: SafeErrorClass | null;
};

export class ProviderError extends Error {
  readonly status: number | null;
  readonly safeError: SafeErrorClass;
  constructor(message: string, safeError: SafeErrorClass, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.safeError = safeError;
  }
}

function requireKey(): string {
  const key = apiKey();
  if (!key) {
    throw new ProviderError(
      "OPENROUTER_API_KEY is not set. Rewrites are disabled until the operator configures a key.",
      "missing_key",
    );
  }
  if (!key.startsWith("sk-or-")) {
    throw new ProviderError("OPENROUTER_API_KEY does not look like an OpenRouter key.", "unauthorized");
  }
  return key;
}

function referer(): string {
  const raw = (process.env.BETTER_AUTH_URL || process.env.APP_ORIGIN || "").trim();
  if (!raw) return "https://localhost";
  try {
    return new URL(raw).origin;
  } catch {
    return "https://localhost";
  }
}

function isModelUnavailable(status: number, body: string): boolean {
  if (status === 404) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("no endpoints found") ||
    lower.includes("is not a valid model")
  );
}

function isTerminalGenerationError(err: unknown): boolean {
  if (err instanceof ProviderError) {
    return (
      err.safeError === "refusal" ||
      err.safeError === "truncated" ||
      err.safeError === "empty" ||
      err.safeError === "unauthorized" ||
      err.safeError === "payment_required" ||
      err.safeError === "missing_key"
    );
  }
  return false;
}

type HealthState = {
  lastAuthOk: boolean | null;
  lastGenerationOk: boolean | null;
  lastGenerationAt: number | null;
};

let healthState: HealthState = {
  lastAuthOk: null,
  lastGenerationOk: null,
  lastGenerationAt: null,
};

export function noteOpenRouterAuth(ok: boolean): void {
  healthState.lastAuthOk = ok;
}

export function noteOpenRouterGeneration(ok: boolean, at = Date.now()): void {
  healthState.lastGenerationOk = ok;
  if (ok) healthState.lastGenerationAt = at;
}

export function resetOpenRouterHealth(): void {
  healthState = { lastAuthOk: null, lastGenerationOk: null, lastGenerationAt: null };
}

export function openRouterHealth(now = Date.now()): GenerationHealth {
  return combineHealth({
    configured: openRouterConfigured(),
    lastAuthOk: healthState.lastAuthOk,
    lastGenerationOk: healthState.lastGenerationOk,
    lastGenerationAt: healthState.lastGenerationAt,
    now,
  });
}

/**
 * Probe result.
 *
 * Return shape: `{ ok: boolean, health: GenerationHealth }`.
 * - `ok` is true only when `health` is `authenticated`, `route_capable`, or
 *   `recently_generated`. A nonempty key (`openRouterConfigured()`) is only
 *   `configured` and is not ready.
 * - `health` is `degraded` when `lastGenerationOk` is false even if
 *   `lastAuthOk` is true, and when a probe fails after an older success.
 *
 * This function does not throw for missing/invalid keys, network errors, or
 * failed HTTP probes. Watch UI checks `ping.ok` before stamping
 * `openrouter_ok_at`. Returning a structured result (never throwing on typical
 * failures) keeps that caller on the try path so a failed probe is not treated
 * as ready via exception.
 *
 * Boolean-coercing callers must check `result.ok` — the object itself is always
 * truthy. `ok: false` is the fail-closed flag.
 */
export type OpenRouterPingResult = {
  ok: boolean;
  health: GenerationHealth;
};

function pingResult(): OpenRouterPingResult {
  const health = openRouterHealth();
  return { ok: healthIsReady(health), health };
}

export async function pingOpenRouter(): Promise<OpenRouterPingResult> {
  try {
    if (!openRouterConfigured()) {
      return pingResult();
    }
    const key = apiKey();
    if (!key.startsWith("sk-or-")) {
      noteOpenRouterAuth(false);
      return pingResult();
    }
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    noteOpenRouterAuth(res.ok);
    return pingResult();
  } catch {
    noteOpenRouterAuth(false);
    return pingResult();
  }
}

export async function chatOpenRouter(opts: ChatOptions): Promise<ChatResult> {
  requireKey();
  const models = opts.models?.length ? opts.models : [DEFAULT_MODEL, ...FALLBACK_MODELS];
  let lastErr = "Reply generation failed";
  const started = Date.now();
  const deadlineMs = opts.deadlineMs ?? opts.timeoutMs ?? DEFAULT_DEADLINE_MS;

  for (const model of models) {
    const remaining = remainingDeadlineMs(started, deadlineMs);
    if (remaining <= 0) {
      noteOpenRouterGeneration(false);
      throw new ProviderError("Reply generation took too long.", "timeout");
    }
    try {
      const result = await chatOnce(model, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? remaining, remaining) }, models);
      noteOpenRouterGeneration(true);
      return result;
    } catch (err) {
      if (isTerminalGenerationError(err)) {
        noteOpenRouterGeneration(false);
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      lastErr = message;
      if (!isModelUnavailable(0, message) && !message.includes("404")) {
        if (!/model|not found|no endpoints/i.test(message)) {
          noteOpenRouterGeneration(false);
          throw err;
        }
      }
    }
  }
  noteOpenRouterGeneration(false);
  throw new Error(lastErr);
}

async function chatOnce(model: string, opts: ChatOptions, models: string[]): Promise<ChatResult> {
  const key = requireKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_DEADLINE_MS);

  const body: Record<string, unknown> = {
    model,
    models,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1200,
    temperature: opts.temperature ?? 0.2,
    reasoning: { effort: "low" },
    provider: {
      sort: opts.providerSort ?? "throughput",
      data_collection: "deny",
      allow_fallbacks: true,
    },
  };

  if (opts.json) {
    body.response_format = { type: "json_object" };
  }

  if (opts.web) {
    body.plugins = [
      {
        id: "web",
        engine: "native",
        max_results: 8,
      },
    ];
  }

  if (opts.xFilter) {
    body.x_search_filter = opts.xFilter;
  }

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer(),
        "X-Title": "X Relay",
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      const safe = classifyHttpStatus(res.status);
      if (isModelUnavailable(res.status, raw)) {
        throw new ProviderError(`model unavailable: ${model}`, "unavailable", res.status);
      }
      let detail = `Reply generation error ${res.status}`;
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        if (raw) detail = raw.slice(0, 280);
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError(
          "The OpenRouter key was rejected. It may be expired or out of credits.",
          "unauthorized",
          res.status,
        );
      }
      if (res.status === 402) {
        throw new ProviderError("OpenRouter payment required.", "payment_required", res.status);
      }
      if (res.status === 429) {
        throw new ProviderError("Reply generation is being rate-limited. Wait a few seconds and try again.", "rate_limited", res.status);
      }
      throw new ProviderError(detail, safe, res.status);
    }

    const data = JSON.parse(raw) as {
      id?: string;
      model?: string;
      choices?: {
        finish_reason?: string;
        native_finish_reason?: string;
        message?: { content?: string | Array<{ type?: string; text?: string }>; refusal?: string };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      error?: { message?: string };
    };
    if (data.error?.message) throw new ProviderError(data.error.message, "unknown");

    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => p.text ?? "").join("")
          : "";
    const finishReason = choice?.finish_reason ?? choice?.native_finish_reason ?? null;
    const classified = classifyFinishReason(finishReason, text);
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : null;
    if (choice?.message?.refusal) {
      throw new ProviderError("model refusal", "refusal");
    }
    if (classified === "truncated") {
      throw new ProviderError("model truncated the reply", "truncated");
    }
    if (classified === "refusal") {
      throw new ProviderError("model refused the completion", "refusal");
    }
    if (!text.trim() || classified === "empty") {
      throw new ProviderError("The model returned an empty reply.", "empty");
    }
    const bad = unusableFinish(finishReason, text);
    if (bad) {
      throw new ProviderError(`model ${bad}`, bad);
    }
    return {
      text,
      model: data.model ?? model,
      finishReason,
      generationId: data.id ?? null,
      usage,
      safeError: null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError("Reply generation took too long.", "timeout");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
      try {
        return JSON.parse(fence[1].trim());
      } catch {
        /* continue */
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Could not parse a JSON payload from the model.");
  }
}

export function openRouterConfigured(): boolean {
  return Boolean(apiKey());
}

export function openRouterKey(): string {
  return requireKey();
}
