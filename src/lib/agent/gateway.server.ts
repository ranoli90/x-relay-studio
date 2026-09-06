/**
 * Model gateway. We own the route table. Never openrouter/auto.
 * Classify is cheap/local. Writer is adult-permissive (xAI / OpenRouter).
 */
import { chatOpenRouter, extractJson, openRouterConfigured, ProviderError } from "../openrouter.server.ts";
import { newId } from "./ids.ts";
import type { WriteInput, WriteResult } from "./types.ts";
import {
  writeLocal,
  validateDraft,
  splitBubbles,
  writeCapsFor,
  shouldSkipRemoteWrite,
  LOCAL_WRITER_MODEL,
} from "./write.ts";
import {
  buildWriterMessages,
  remainingDeadlineMs,
  unusableFinish,
  WRITER_UNTRUSTED_POLICY,
} from "../conversation/generate.ts";

export type AgentTask =
  | "understand"
  | "plan"
  | "write"
  | "hard_write"
  | "diary"
  | "vision"
  | "judge";

type Route = {
  task: AgentTask;
  primary: string;
  fallback: string[];
  sort: "price" | "throughput";
  timeoutMs: number;
  maxTokens: number;
};

const TABLE: Record<AgentTask, Route> = {
  understand: {
    task: "understand",
    primary: "deepseek/deepseek-chat",
    fallback: ["z-ai/glm-5.3-flash"],
    sort: "price",
    timeoutMs: 800,
    maxTokens: 220,
  },
  plan: {
    task: "plan",
    primary: "z-ai/glm-5.3-flash",
    fallback: ["x-ai/grok-4"],
    sort: "price",
    timeoutMs: 4000,
    maxTokens: 400,
  },
  write: {
    task: "write",
    primary: "x-ai/grok-4.5",
    fallback: ["x-ai/grok-4", "x-ai/grok-4-fast", "minimax/minimax-m3", "deepseek/deepseek-chat"],
    sort: "throughput",
    timeoutMs: 12000,
    maxTokens: 280,
  },
  hard_write: {
    task: "hard_write",
    primary: "x-ai/grok-4.5",
    fallback: ["x-ai/grok-4.6", "x-ai/grok-4"],
    sort: "throughput",
    timeoutMs: 16000,
    maxTokens: 400,
  },
  diary: {
    task: "diary",
    primary: "z-ai/glm-5.3-flash",
    fallback: ["deepseek/deepseek-chat"],
    sort: "price",
    timeoutMs: 4000,
    maxTokens: 240,
  },
  vision: {
    task: "vision",
    primary: "z-ai/glm-5.3-flash",
    fallback: ["minimax/minimax-m3"],
    sort: "price",
    timeoutMs: 8000,
    maxTokens: 200,
  },
  judge: {
    task: "judge",
    primary: "x-ai/grok-4.6",
    fallback: [],
    sort: "price",
    timeoutMs: 20000,
    maxTokens: 600,
  },
};

function xaiKey(): string {
  return process.env.XAI_API_KEY?.trim() ?? "";
}

export function writerAvailable(): boolean {
  return openRouterConfigured() || Boolean(xaiKey());
}

async function logCall(opts: {
  userId: string;
  threadId?: string | null;
  task: AgentTask;
  model: string;
  latencyMs: number;
  outcome: string;
  fallback: boolean;
  finishReason?: string | null;
  generationId?: string | null;
  safeError?: string | null;
  usageJson?: string | null;
}) {
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    await sql.query(
      `insert into agent_model_calls
        (id, user_id, thread_id, task, model, latency_ms, outcome, fallback,
         finish_reason, provider_generation_id, safe_error, usage_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        newId("call"),
        opts.userId,
        opts.threadId ?? null,
        opts.task,
        opts.model,
        opts.latencyMs,
        opts.outcome,
        opts.fallback,
        opts.finishReason ?? null,
        opts.generationId ?? null,
        opts.safeError ?? null,
        opts.usageJson ?? null,
      ],
    );
  } catch {
    try {
      const { getSql } = await import("../db.ts");
      const sql = await getSql();
      await sql.query(
        `insert into agent_model_calls
          (id, user_id, thread_id, task, model, latency_ms, outcome, fallback)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId("call"),
          opts.userId,
          opts.threadId ?? null,
          opts.task,
          opts.model,
          opts.latencyMs,
          opts.outcome,
          opts.fallback,
        ],
      );
    } catch {
      /* logging must never break the brain */
    }
  }
}

async function chatXai(opts: {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  maxTokens: number;
  timeoutMs: number;
  json?: boolean;
}): Promise<{ text: string; model: string; finishReason: string | null }> {
  const key = xaiKey();
  if (!key) throw new Error("XAI_API_KEY missing");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(opts.timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: opts.model.startsWith("x-ai/") ? opts.model.slice(5) : opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      temperature: 0.4,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`xAI ${res.status}`);
  const body = (await res.json()) as {
    model?: string;
    choices?: {
      finish_reason?: string;
      message?: { content?: string; refusal?: string };
    }[];
  };
  const choice = body.choices?.[0];
  const text = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? null;
  if (choice?.message?.refusal) {
    throw new ProviderError("model refusal", "refusal");
  }
  const bad = unusableFinish(finishReason, text);
  if (bad) {
    throw new ProviderError(`model ${bad}`, bad);
  }
  if (!text.trim()) throw new ProviderError("empty", "empty");
  return { text, model: body.model ?? opts.model, finishReason };
}

type TaskResult = { text: string; model: string; fallback: boolean; finishReason?: string | null };

export async function runTask(opts: {
  userId: string;
  threadId?: string | null;
  task: AgentTask;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  json?: boolean;
}): Promise<TaskResult | null> {
  const route = TABLE[opts.task];
  const started = Date.now();
  const models = [route.primary, ...route.fallback];
  const budgetMs = route.timeoutMs;

  if (openRouterConfigured()) {
    const remaining = remainingDeadlineMs(started, budgetMs);
    if (remaining > 0) {
      try {
        const result = await chatOpenRouter({
          messages: opts.messages,
          maxTokens: route.maxTokens,
          timeoutMs: remaining,
          deadlineMs: remaining,
          json: opts.json,
          temperature: opts.task === "write" || opts.task === "hard_write" ? 0.6 : 0.2,
          models,
          providerSort: route.sort,
        });
        const bad = unusableFinish(result.finishReason, result.text);
        if (bad) {
          await logCall({
            userId: opts.userId,
            threadId: opts.threadId,
            task: opts.task,
            model: result.model,
            latencyMs: Date.now() - started,
            outcome: bad,
            fallback: false,
            finishReason: result.finishReason,
            generationId: result.generationId,
            safeError: bad,
            usageJson: result.usage ? JSON.stringify(result.usage) : null,
          });
          return null;
        }
        await logCall({
          userId: opts.userId,
          threadId: opts.threadId,
          task: opts.task,
          model: result.model,
          latencyMs: Date.now() - started,
          outcome: "ok",
          fallback: false,
          finishReason: result.finishReason,
          generationId: result.generationId,
          usageJson: result.usage ? JSON.stringify(result.usage) : null,
        });
        return { text: result.text, model: result.model, fallback: false, finishReason: result.finishReason };
      } catch (err) {
        const safe = err instanceof ProviderError ? err.safeError : "unknown";
        await logCall({
          userId: opts.userId,
          threadId: opts.threadId,
          task: opts.task,
          model: models[0],
          latencyMs: Date.now() - started,
          outcome: err instanceof Error ? err.message.slice(0, 80) : "fail",
          fallback: false,
          safeError: safe,
        });
        if (err instanceof ProviderError && (safe === "refusal" || safe === "truncated" || safe === "empty")) {
          return null;
        }
        /* fall through to xAI / local within the same deadline */
      }
    }
  }

  const xaiRemaining = remainingDeadlineMs(started, budgetMs);
  if (xaiKey() && xaiRemaining > 200 && (opts.task === "write" || opts.task === "hard_write" || opts.task === "plan")) {
    try {
      const result = await chatXai({
        model: "grok-4.5",
        messages: opts.messages,
        maxTokens: route.maxTokens,
        timeoutMs: Math.min(xaiRemaining, 12_000),
        json: opts.json,
      });
      const bad = unusableFinish(result.finishReason, result.text);
      if (bad) {
        await logCall({
          userId: opts.userId,
          threadId: opts.threadId,
          task: opts.task,
          model: result.model,
          latencyMs: Date.now() - started,
          outcome: bad,
          fallback: true,
          finishReason: result.finishReason,
          safeError: bad,
        });
        return null;
      }
      await logCall({
        userId: opts.userId,
        threadId: opts.threadId,
        task: opts.task,
        model: result.model,
        latencyMs: Date.now() - started,
        outcome: "ok",
        fallback: true,
        finishReason: result.finishReason,
      });
      return { text: result.text, model: result.model, fallback: true, finishReason: result.finishReason };
    } catch (err) {
      const safe = err instanceof ProviderError ? err.safeError : "unknown";
      await logCall({
        userId: opts.userId,
        threadId: opts.threadId,
        task: opts.task,
        model: models[0],
        latencyMs: Date.now() - started,
        outcome: err instanceof Error ? err.message.slice(0, 80) : "fail",
        fallback: true,
        safeError: safe,
      });
      return null;
    }
  }

  await logCall({
    userId: opts.userId,
    threadId: opts.threadId,
    task: opts.task,
    model: "local/understand",
    latencyMs: Date.now() - started,
    outcome: "local",
    fallback: true,
  });
  return null;
}

export async function writeWithGateway(userId: string, threadId: string, input: WriteInput): Promise<WriteResult> {
  const local = writeLocal(input);
  if (shouldSkipRemoteWrite(input, local)) return local;
  if (!writerAvailable()) {
    return { bubbles: [], dropped: true, dropReason: "provider_unavailable", model: LOCAL_WRITER_MODEL };
  }

  const caps = writeCapsFor(input);
  const { system, user } = buildWriterMessages(input, caps);

  const llm = await runTask({
    userId,
    threadId,
    task: "write",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  if (!llm) {
    return { bubbles: [], dropped: true, dropReason: "generation_failed", model: LOCAL_WRITER_MODEL };
  }
  const badFinish = unusableFinish(llm.finishReason, llm.text);
  if (badFinish) {
    return { bubbles: [], dropped: true, dropReason: badFinish, model: llm.model };
  }
  const drop = validateDraft(llm.text, input.catalog, input.hour, input.clock, caps);
  if (drop) {
    return { bubbles: [], dropped: true, dropReason: `validator_rejected: ${drop}`, model: llm.model };
  }
  return { bubbles: splitBubbles(llm.text), dropped: false, dropReason: null, model: llm.model };
}

export { extractJson, TABLE as ROUTE_TABLE, buildWriterMessages, WRITER_UNTRUSTED_POLICY };
