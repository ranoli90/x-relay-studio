import { createFileRoute } from "@tanstack/react-router";
import { applyMarkPaid, FanPaySchema, fanWebhookAuthorized } from "@/lib/agent/pay";
import { withTransaction } from "@/lib/db";

function allowed(request: Request): boolean {
  return fanWebhookAuthorized(
    request.headers.get("authorization"),
    process.env.PAYMENTS_WEBHOOK_SECRET,
  );
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!allowed(request)) {
          return json(401, { ok: false, error: "unauthorized" });
        }
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json(400, { ok: false, error: "bad json" });
        }
        const parsed = FanPaySchema.safeParse(raw);
        if (!parsed.success) {
          return json(400, { ok: false, error: "missing fields" });
        }
        try {
          const result = await withTransaction((sql) => applyMarkPaid(sql, null, parsed.data));
          if (!result.ok) {
            const status = result.reason === "not_found" ? 404 : 409;
            return json(status, { ok: false, error: result.reason });
          }
          return json(200, {
            ok: true,
            replay: result.replay,
            offerId: result.offerId,
            threadId: result.threadId,
            truth: "webhook",
          });
        } catch {
          return json(500, { ok: false, error: "unavailable" });
        }
      },
    },
  },
});
