import { createFileRoute } from "@tanstack/react-router";
import { completeRedditOAuth } from "@/lib/reddit/complete-oauth";
import { takeTicketByState } from "@/lib/reddit/store";

function page(script: string, message: string) {
  return new Response(
    `<!doctype html>
<html><head><meta charset="utf-8"><title>Reddit</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0e;color:#e8e6e3;font-family:ui-sans-serif,system-ui;}</style>
</head><body><p>${message}</p><script>${script}</script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/reddit/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const err = url.searchParams.get("error");
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const notify = (payload: Record<string, unknown>) =>
          `try{if(window.opener){window.opener.postMessage(${JSON.stringify({ type: "reddit-oauth", ...payload })}, "*");}window.close();}catch(e){}setTimeout(function(){location.replace(${JSON.stringify(payload.ok ? "/?reddit=1" : "/?reddit_error=1")});},400);`;

        if (err === "access_denied") {
          return page(notify({ ok: false, error: "denied" }), "You cancelled. You can close this window.");
        }
        if (!code || !state) {
          return page(notify({ ok: false, error: "missing" }), "Reddit did not return a login code.");
        }
        const ticket = await takeTicketByState(state);
        if (!ticket) {
          return page(notify({ ok: false, error: "expired" }), "This login expired. Close this window and try again.");
        }
        if (new Date(ticket.expires_at).getTime() < Date.now()) {
          return page(notify({ ok: false, error: "expired" }), "This login expired. Close this window and try again.");
        }
        try {
          const done = await completeRedditOAuth({
            userId: ticket.user_id,
            code,
            redirectUri: ticket.redirect_uri,
          });
          return page(
            notify({ ok: true, accountId: done.accountId, name: done.name }),
            `Connected u/${done.name}. You can close this window.`,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Connect failed.";
          return page(notify({ ok: false, error: message }), message);
        }
      },
    },
  },
});
