import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { markPaid } from "@/lib/agent/brain.server";

function allowed(request: Request): boolean {
  const secret = process.env.PAYMENTS_WEBHOOK_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!allowed(request)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        let body: {
          userId?: string;
          offerId?: string;
          rail?: string;
          externalId?: string;
          amountCents?: number;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        if (!body.userId || !body.offerId || !body.rail || !body.externalId || !body.amountCents) {
          return new Response(JSON.stringify({ ok: false, error: "missing fields" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const res = await markPaid({
          userId: body.userId,
          offerId: body.offerId,
          rail: body.rail,
          externalId: body.externalId,
          amountCents: body.amountCents,
        });
        return Response.json({ ok: res.ok, truth: "webhook" });
      },
    },
  },
});
