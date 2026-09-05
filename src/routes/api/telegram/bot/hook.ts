import { createFileRoute } from "@tanstack/react-router";
import { findByWebhookSecret, ingestUpdates } from "@/lib/telegram/credentials.server";
import type { TelegramUpdate } from "@/lib/telegram/bot.server";

export const Route = createFileRoute("/api/telegram/bot/hook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const secret =
          url.searchParams.get("s") ?? request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (!secret) return new Response("no", { status: 401 });
        const row = await findByWebhookSecret(secret);
        if (!row) return new Response("no", { status: 401 });
        const header = request.headers.get("x-telegram-bot-api-secret-token");
        if (header && row.webhook_secret && header !== row.webhook_secret) {
          return new Response("no", { status: 401 });
        }
        let update: TelegramUpdate;
        try {
          update = (await request.json()) as TelegramUpdate;
        } catch {
          return new Response("bad", { status: 400 });
        }
        if (!update || typeof update.update_id !== "number") {
          return new Response("bad", { status: 400 });
        }
        await ingestUpdates(row.user_id, [update]);
        return Response.json({ ok: true });
      },
    },
  },
});
