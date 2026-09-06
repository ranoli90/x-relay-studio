import { createFileRoute } from "@tanstack/react-router";
import { completeRedditOAuth, WrongAccountError } from "@/lib/reddit/complete-oauth";
import { escapeHtml } from "@/lib/reddit/html";
import { takeTicketByState } from "@/lib/reddit/store";
import { getSql } from "@/lib/db";
import { OnboardingError } from "@/lib/reddit/onboarding/types";
import { decideOauthCallback, type OauthTicketSnapshot } from "@/lib/reddit/oauth-callback-gate";

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
        const existing = await sql.query<OauthTicketSnapshot & { ticket: string; state?: string }>(
          `select ticket, user_id, redirect_uri, expires_at, processing_state, processed_result_json,
                  job_id, expected_username, expected_reddit_id, correlation_id, credential_version,
                  allowed_origin, cancelled_at, exchange_started_at, purpose, attempt_generation
             from reddit_oauth_tickets where state = $1 limit 1`,
          [state],
        );
        const row = existing[0];
        const ticket = row ?? (await takeTicketByState(state));
        if (!ticket) {
          return page(notifyScript({ ok: false, error: "expired" }, origin), "This login expired. Close this window and try again.");
        }
        const target = (() => {
          try {
            const allowed = "allowed_origin" in ticket ? ticket.allowed_origin : null;
            if (allowed) return new URL(allowed).origin;
            return new URL(ticket.redirect_uri).origin;
          } catch {
            return origin;
          }
        })();
        let linkedAccount: { id: string; name: string } | null = null;
        if ("job_id" in ticket && ticket.job_id) {
          const jobs = await sql.query<{
            account_id: string | null;
            verified_username: string | null;
            cancel_requested_at: string | Date | null;
            status: string;
          }>(
            `select account_id, verified_username, cancel_requested_at, status
               from reddit_onboarding_jobs where id = $1 and user_id = $2 limit 1`,
            [ticket.job_id, ticket.user_id],
          );
          const job = jobs[0];
          if (job?.account_id && job.verified_username) {
            linkedAccount = { id: job.account_id, name: job.verified_username };
          }
          if (!job || job.cancel_requested_at || job.status === "cancelled") {
            return page(
              notifyScript({ ok: false, error: "cancelled", correlationId: ticket.correlation_id }, target),
              "This setup was cancelled before Reddit login finished.",
            );
          }
        }
        const decision = decideOauthCallback({
          ticket,
          requestOrigin: origin,
          linkedAccount,
        });
        if (decision.action === "reject") {
          return page(
            notifyScript({ ok: false, error: decision.error, correlationId: ticket.correlation_id }, target),
            decision.error === "cancelled"
              ? "This login was cancelled."
              : decision.error === "origin"
                ? "This login returned to the wrong site."
                : decision.error === "correlation"
                  ? "This login is missing its correlation identifier."
                  : "This login expired. Close this window and try again.",
          );
        }
        if (decision.action === "replay") {
          return page(
            notifyScript({ ...decision.result, correlationId: ticket.correlation_id }, target),
            decision.result.ok ? `Connected u/${String(decision.result.name || "")}.` : String(decision.result.error || "Already processed."),
          );
        }
        if (decision.action === "recover") {
          const result = { ok: true, accountId: decision.accountId, name: decision.name, correlationId: ticket.correlation_id };
          await sql.query(
            `update reddit_oauth_tickets
                set processing_state = 'completed', processed_result_json = $2, exchange_completed_at = now()
              where state = $1`,
            [state, JSON.stringify(result)],
          );
          return page(notifyScript(result, target), `Connected u/${decision.name}. You can close this window.`);
        }
        if (decision.action === "uncertain") {
          await sql.query(
            `update reddit_oauth_tickets
                set processing_state = 'failed', processed_result_json = $2
              where state = $1 and processing_state = 'processing'`,
            [state, JSON.stringify({ ok: false, error: "uncertain", correlationId: ticket.correlation_id })],
          );
          return page(
            notifyScript({ ok: false, error: "uncertain", correlationId: ticket.correlation_id }, target),
            "This login was interrupted. Start Connect with Reddit again. The previous code cannot be reused.",
          );
        }
        if (decision.action === "busy") {
          return page(notifyScript({ ok: false, error: "busy", correlationId: ticket.correlation_id }, target), "This login is already being processed.");
        }
        const claimed = await sql.query(
          `update reddit_oauth_tickets
              set processing_state = 'processing', exchange_started_at = coalesce(exchange_started_at, now())
            where state = $1 and coalesce(processing_state, 'open') = 'open'
            returning ticket`,
          [state],
        );
        if (!claimed[0] && !ticket.processed_result_json) {
          return page(notifyScript({ ok: false, error: "busy", correlationId: ticket.correlation_id }, target), "This login is already being processed.");
        }
        try {
          const done = await completeRedditOAuth({
            userId: ticket.user_id,
            code,
            redirectUri: ticket.redirect_uri,
            expectedUsername: ticket.expected_username,
            expectedRedditId: ticket.expected_reddit_id,
            jobId: ticket.job_id,
            credentialVersion: ticket.credential_version,
            allowedOrigin: "allowed_origin" in ticket ? ticket.allowed_origin : null,
            correlationId: ticket.correlation_id,
          });
          const result = { ok: true, accountId: done.accountId, name: done.name, correlationId: ticket.correlation_id };
          await sql.query(
            `update reddit_oauth_tickets
                set processing_state = 'completed', processed_result_json = $2, exchange_completed_at = now()
              where state = $1`,
            [state, JSON.stringify(result)],
          );
          return page(notifyScript(result, target), `Connected u/${done.name}. You can close this window.`);
        } catch (e) {
          const message =
            e instanceof WrongAccountError
              ? "Reddit signed in a different account. That grant was not attached."
              : e instanceof OnboardingError
                ? e.message
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
