import { createFileRoute } from "@tanstack/react-router";
import { completeRedditOAuth, WrongAccountError } from "@/lib/reddit/complete-oauth";
import { escapeHtml } from "@/lib/reddit/html";
import { takeTicketByState } from "@/lib/reddit/store";
import { getSql } from "@/lib/db";

function page(script: string, message: string) {
  return new Response(
    `<!doctype html>
<html><head><meta charset="utf-8"><title>Reddit</title>
<meta name="referrer" content="no-referrer">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0e;color:#e8e6e3;font-family:ui-sans-serif,system-ui;}</style>
</head><body><p>${escapeHtml(message)}</p><script>${script}</script></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

function notifyScript(payload: Record<string, unknown>, targetOrigin: string) {
  const json = JSON.stringify({ type: "reddit-oauth", ...payload }).replace(/</g, "\\u003c");
  return `try{if(window.opener){window.opener.postMessage(${json},${JSON.stringify(targetOrigin)});}window.close();}catch(e){}setTimeout(function(){location.replace("/reddit");},400);`;
}

export const Route = createFileRoute("/api/reddit/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const err = url.searchParams.get("error");
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";

        if (err === "access_denied") {
          return page(notifyScript({ ok: false, error: "denied" }, origin), "You cancelled. You can close this window.");
        }
        if (!code || !state) {
          return page(notifyScript({ ok: false, error: "missing" }, origin), "Reddit did not return a login code.");
        }
        const sql = await getSql();
        const existing = await sql.query<{
          ticket: string;
          user_id: string;
          redirect_uri: string;
          expires_at: string | Date;
          processing_state: string | null;
          processed_result_json: string | null;
          job_id: string | null;
          expected_username: string | null;
          expected_reddit_id: string | null;
          correlation_id: string | null;
        }>(
          `select ticket, user_id, redirect_uri, expires_at, processing_state, processed_result_json,
                  job_id, expected_username, expected_reddit_id, correlation_id
             from reddit_oauth_tickets where state = $1 limit 1`,
          [state],
        );
        const row = existing[0];
        const ticket = row ?? (await takeTicketByState(state));
        if (!ticket) {
          return page(notifyScript({ ok: false, error: "expired" }, origin), "This login expired. Close this window and try again.");
        }
        if (ticket.processed_result_json) {
          const prior = JSON.parse(ticket.processed_result_json) as { ok?: boolean; name?: string; error?: string };
          const target = new URL(ticket.redirect_uri).origin;
          return page(
            notifyScript({ ...prior, correlationId: ticket.correlation_id }, target),
            prior.ok ? `Connected u/${prior.name || ""}.` : prior.error || "Already processed.",
          );
        }
        if (new Date(ticket.expires_at).getTime() < Date.now()) {
          return page(notifyScript({ ok: false, error: "expired" }, origin), "This login expired. Close this window and try again.");
        }
        const claimed = await sql.query(
          `update reddit_oauth_tickets
              set processing_state = 'processing'
            where state = $1 and coalesce(processing_state, 'open') = 'open'
            returning ticket`,
          [state],
        );
        if (!claimed[0] && !ticket.processed_result_json) {
          return page(notifyScript({ ok: false, error: "busy" }, origin), "This login is already being processed.");
        }
        const target = (() => {
          try {
            return new URL(ticket.redirect_uri).origin;
          } catch {
            return origin;
          }
        })();
        try {
          const done = await completeRedditOAuth({
            userId: ticket.user_id,
            code,
            redirectUri: ticket.redirect_uri,
            expectedUsername: ticket.expected_username,
            expectedRedditId: ticket.expected_reddit_id,
            jobId: ticket.job_id,
          });
          const result = { ok: true, accountId: done.accountId, name: done.name, correlationId: ticket.correlation_id };
          await sql.query(
            `update reddit_oauth_tickets
                set processing_state = 'completed', processed_result_json = $2
              where state = $1`,
            [state, JSON.stringify(result)],
          );
          return page(notifyScript(result, target), `Connected u/${done.name}. You can close this window.`);
        } catch (e) {
          const message =
            e instanceof WrongAccountError
              ? "Reddit signed in a different account. That grant was not attached."
              : e instanceof Error
                ? e.message
                : "Connect failed.";
          const result = { ok: false, error: message, correlationId: ticket.correlation_id };
          await sql.query(
            `update reddit_oauth_tickets
                set processing_state = 'failed', processed_result_json = $2
              where state = $1`,
            [state, JSON.stringify(result)],
          );
          return page(notifyScript(result, target), message);
        }
      },
    },
  },
});
