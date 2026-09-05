/**
 * Model gateway. We own the route table. Never openrouter/auto.
 * Classify is cheap/local. Writer is adult-permissive (xAI / OpenRouter).
 */
import { chatOpenRouter, extractJson, openRouterConfigured } from "@/lib/openrouter.server";
import { getSql } from "@/lib/db";
import { newId } from "./ids.ts";
import type { WriteInput, WriteResult } from "./types.ts";
import {
  writeLocal,
  validateDraft,
  splitBubbles,
  writeCapsFor,
  shouldSkipRemoteWrite,
} from "./write.ts";

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
}) {
  try {
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

async function chatXai(opts: {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  maxTokens: number;
  timeoutMs: number;
  json?: boolean;
}): Promise<{ text: string; model: string }> {
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
    choices?: { message?: { content?: string } }[];
  };
  const text = body.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("empty");
  return { text, model: body.model ?? opts.model };
}

export async function runTask(opts: {
  userId: string;
  threadId?: string | null;
  task: AgentTask;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  json?: boolean;
}): Promise<{ text: string; model: string; fallback: boolean } | null> {
  const route = TABLE[opts.task];
  const started = Date.now();
  const models = [route.primary, ...route.fallback];

  if (openRouterConfigured()) {
    try {
      const result = await chatOpenRouter({
        messages: opts.messages,
        maxTokens: route.maxTokens,
        timeoutMs: route.timeoutMs,
        json: opts.json,
        temperature: opts.task === "write" || opts.task === "hard_write" ? 0.6 : 0.2,
        models,
        providerSort: route.sort,
      });
      await logCall({
        userId: opts.userId,
        threadId: opts.threadId,
        task: opts.task,
        model: result.model,
        latencyMs: Date.now() - started,
        outcome: "ok",
        fallback: false,
      });
      return { text: result.text, model: result.model, fallback: false };
    } catch {
      /* fall through to xAI / local */
    }
  }

  if (xaiKey() && (opts.task === "write" || opts.task === "hard_write" || opts.task === "plan")) {
    try {
      const result = await chatXai({
        model: "grok-4.5",
        messages: opts.messages,
        maxTokens: route.maxTokens,
        timeoutMs: Math.min(route.timeoutMs, 12_000),
        json: opts.json,
      });
      await logCall({
        userId: opts.userId,
        threadId: opts.threadId,
        task: opts.task,
        model: result.model,
        latencyMs: Date.now() - started,
        outcome: "ok",
        fallback: true,
      });
      return { text: result.text, model: result.model, fallback: true };
    } catch (err) {
      await logCall({
        userId: opts.userId,
        threadId: opts.threadId,
        task: opts.task,
        model: models[0],
        latencyMs: Date.now() - started,
        outcome: err instanceof Error ? err.message.slice(0, 80) : "fail",
        fallback: true,
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
  if (!writerAvailable()) return local;
  // Handoff / kill / W2 safety / no-rails holds never call the model (including hard_write).
  if (shouldSkipRemoteWrite(input, local)) return local;

  const caps = writeCapsFor(input);
  const rails =
    caps.allowedMethods && caps.allowedMethods.length > 0
      ? caps.allowedMethods.join(", ")
      : "(none — do not name any rail or payment method)";
  const catalogLines = input.catalog
    .map((c) => `${c.sku} ${c.title} $${(c.priceCents / 100).toFixed(0)} rail=${c.rail}`)
    .join("\n");
  const diary = input.diary.map((d) => `${d.voice}: ${d.body}`).join("\n");
  const last = input.last.map((m) => `${m.role}: ${m.body}`).join("\n");
  const clock = input.clock.map((c) => `${c.kind} ${c.startHour}-${c.endHour} ${c.claim}`).join("; ");
  const proofLine = caps.proofAvailable
    ? "An unused proof asset is reserved. You may offer that reserved asset. Never promise a live selfie or a recycled live."
    : "NO proof asset is reserved. Do not promise a selfie, verification pic, same-outfit, live proof, or that you can send one.";
  const deliveryLine = caps.deliveryConfirmed
    ? "Delivery is confirmed. You may say you got it to them."
    : "Delivery is NOT confirmed. Do not claim you sent, delivered, or that it is in their inbox.";

  const system = `You write as ${input.personaName}. Short Telegram bubbles. Lowercase ok. No emoji. Never say you are an AI.
Never invent a price or a payment rail. Catalog only:
${catalogLines}
Only these payment rails may be named: ${rails}
${proofLine}
${deliveryLine}
Life clock now hour=${input.hour}: ${clock}
Do not contradict ME claims or the clock (no gym+bed at the wrong hour).
Forbidden in output: strategy=, trust_score, gfe_ready, as an ai, as a language model, openrouter, system prompt, gift cards, restriction workarounds, bypass language, prices not on the list, payment methods not on the allowlist.
Plan you must follow: workflow=${input.plan.workflow} tactic=${input.plan.tactic} sku=${input.plan.sku ?? "none"}
hold=${input.plan.hold} is about whether the desk may auto-send. You still write the draft. Do not mention hold, workflow ids, or plan fields.
Sound like a person who remembers one fact and asks one thing. Do not write a bare "hey what's up" as the whole reply.
${input.bible}
Diary for THIS fan only:
${diary}`;

  const user = `Fan ${input.fanName} just said:\n${input.inbound}\n\nLast 20:\n${last}\n\nWrite 1-2 short bubbles. Split with a blank line.`;

  const llm = await runTask({
    userId,
    threadId,
    task: "write",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  if (!llm) return local;
  const drop = validateDraft(llm.text, input.catalog, input.hour, input.clock, caps);
  // Failed remote text does not smear a remote model id onto a successful local draft.
  if (drop) return local;
  return { bubbles: splitBubbles(llm.text), dropped: false, dropReason: null, model: llm.model };
}

export { extractJson, TABLE as ROUTE_TABLE };
