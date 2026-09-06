import { createFileRoute } from "@tanstack/react-router";
import { authorizeUrl } from "@/lib/reddit/oauth";
import { getApp, getTicket, purgeExpiredTickets } from "@/lib/reddit/store";
import { escapeHtml } from "@/lib/reddit/html";

function html(body: string, status = 400) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Reddit</title><body style="font-family:system-ui;background:#0b0c0e;color:#e8e6e3;padding:48px">${escapeHtml(body)}</body>`,
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
        await purgeExpiredTickets();
        const row = await getTicket(ticket);
        if (!row) return html("This login link expired. Close this window and click Continue with Reddit again.");
        if (row.cancelled_at) return html("This login was cancelled. Close this window and start again.");
        if (row.purpose && row.purpose !== "connect_account") {
          return html("This login attempt is not valid for connecting an account.");
        }
        if (!row.correlation_id) return html("This login is missing its correlation identifier.");
        if (new Date(row.expires_at).getTime() < Date.now()) {
          return html("This login link expired. Close this window and try again.");
        }
        const app = await getApp(row.user_id);
        if (!app) return html("Reddit app is not configured.");
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
