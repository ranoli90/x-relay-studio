import { createFileRoute } from "@tanstack/react-router";
import type { TelegramUpdate } from "@/lib/telegram/bot.server";
import { findByWebhookSecret, ingestUpdates } from "@/lib/telegram/credentials.server";
import { takeRate } from "@/lib/telegram/rate.server";

export const Route = createFileRoute("/api/telegram/bot/hook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (!header) return new Response("no", { status: 401 });
        const row = await findByWebhookSecret(header);
        if (!row) return new Response("no", { status: 401 });
        let update: TelegramUpdate;
        try {
          update = (await request.json()) as TelegramUpdate;
        } catch {
          return new Response("bad", { status: 400 });
        }
        if (!update || typeof update.update_id !== "number") {
          return new Response("bad", { status: 400 });
        }
        try {
          await takeRate(row.user_id, "webhook", 120, 60_000);
        } catch {
          return new Response("rate", {
            status: 429,
            headers: { "retry-after": "30" },
          });
        }
        try {
          await ingestUpdates(row.user_id, [update]);
        } catch {
          return new Response("retry", { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
