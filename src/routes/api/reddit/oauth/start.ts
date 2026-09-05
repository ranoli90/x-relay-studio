import { createFileRoute } from "@tanstack/react-router";
import { authorizeUrl } from "@/lib/reddit/oauth";
import { takeTicket } from "@/lib/reddit/store";
import { getApp } from "@/lib/reddit/store";

function html(body: string, status = 400) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Reddit</title><body style="font-family:system-ui;background:#0b0c0e;color:#e8e6e3;padding:48px">${body}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/reddit/oauth/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const ticket = url.searchParams.get("ticket") ?? "";
        if (!ticket) return html("Missing ticket. Close this window and try again.");
        const row = await takeTicket(ticket);
        if (!row) return html("This login link expired. Close this window and click Continue with Reddit again.");
        if (new Date(row.expires_at).getTime() < Date.now()) {
          return html("This login link expired. Close this window and try again.");
        }
        const app = await getApp(row.user_id);
        if (!app) return html("Reddit app is not configured.");
        // Re-insert state-only so the callback can find it (ticket was one-time for start).
        const { insertTicket } = await import("@/lib/reddit/store");
        await insertTicket({
          ticket: crypto.randomUUID(),
          userId: row.user_id,
          state: row.state,
          redirectUri: row.redirect_uri,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });
        const loc = authorizeUrl({
          clientId: app.client_id,
          redirectUri: row.redirect_uri,
          state: row.state,
        });
        return new Response(null, {
          status: 302,
          headers: { Location: loc },
        });
      },
    },
  },
});
