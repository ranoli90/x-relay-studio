/**
 * OpenRouter is locked in — the key never leaves the server and is never
 * asked for in the UI. Env OPENROUTER_API_KEY overrides if present.
 */
const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY ??
  "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";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_MODEL = "x-ai/grok-4.6";
const FALLBACK_MODELS = ["x-ai/grok-4.5", "x-ai/grok-4.3"];

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  web?: boolean;
  timeoutMs?: number;
  xFilter?: {
    allowed_x_handles?: string[];
    from_date?: string;
    to_date?: string;
  };
};

export type ChatResult = {
  text: string;
  model: string;
};

function isModelUnavailable(status: number, body: string): boolean {
  if (status === 404) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("no endpoints found") ||
    lower.includes("is not a valid model")
  );
}

export async function chatOpenRouter(opts: ChatOptions): Promise<ChatResult> {
  const models = [DEFAULT_MODEL, ...FALLBACK_MODELS];
  let lastErr = "OpenRouter request failed";

  for (const model of models) {
    try {
      return await chatOnce(model, opts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastErr = message;
      if (!isModelUnavailable(0, message) && !message.includes("404")) {
        // Only fall through on missing-model; other errors are real.
        if (!/model|not found|no endpoints/i.test(message)) throw err;
      }
    }
  }
  throw new Error(lastErr);
}

async function chatOnce(model: string, opts: ChatOptions): Promise<ChatResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 55_000);

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1200,
    temperature: opts.temperature ?? 0.2,
    reasoning: { effort: "low" },
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
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://xrelay.app",
        "X-Title": "X Relay",
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      if (isModelUnavailable(res.status, raw)) {
        throw new Error(`model unavailable: ${model}`);
      }
      let detail = `OpenRouter error ${res.status}`;
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        if (raw) detail = raw.slice(0, 280);
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error("The OpenRouter key was rejected. It may be expired or out of credits.");
      }
      if (res.status === 429) {
        throw new Error("X search is being rate-limited. Wait a few seconds and try again.");
      }
      throw new Error(detail);
    }

    const data = JSON.parse(raw) as {
      model?: string;
      choices?: { message?: { content?: string | Array<{ type?: string; text?: string }> } }[];
      error?: { message?: string };
    };
    if (data.error?.message) throw new Error(data.error.message);

    const content = data.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => p.text ?? "").join("")
          : "";
    if (!text.trim()) throw new Error("The model returned an empty reply.");
    return { text, model: data.model ?? model };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The search took too long. Try a tighter query.");
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

export function openRouterKey(): string {
  return OPENROUTER_API_KEY;
}

export async function pingOpenRouter(): Promise<boolean> {
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    signal: AbortSignal.timeout(12_000),
  });
  return res.ok;
}
