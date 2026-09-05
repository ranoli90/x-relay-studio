import { createFileRoute } from "@tanstack/react-router";
import type { TelegramUpdate } from "@/lib/telegram/bot.server";
import { findByWebhookSecret, ingestUpdates } from "@/lib/telegram/credentials.server";
import { timingSafeEqualString } from "@/lib/telegram/crypto.server";
import { takeRate } from "@/lib/telegram/snapshot.server";

export const Route = createFileRoute("/api/telegram/bot/hook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        const query = url.searchParams.get("s") ?? "";
        const secret = header || query;
        if (!secret) return new Response("no", { status: 401 });
        const row = await findByWebhookSecret(secret);
        if (!row?.webhook_secret) return new Response("no", { status: 401 });
        if (!timingSafeEqualString(secret, row.webhook_secret)) {
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
        try {
          await takeRate(row.user_id, "webhook", 120, 60_000);
        } catch {
          return Response.json({ ok: true });
        }
        await ingestUpdates(row.user_id, [update]);
        return Response.json({ ok: true });
      },
    },
  },
});
