import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [{ title: "Terms · X Relay" }],
  }),
});

function TermsPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-bg px-4 py-10 text-fg">
      <Logo />
      <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">Terms</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Use the official doors.</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          X Relay is not X Corp, Telegram FZ-LLC, or Reddit Inc. Connecting a platform means you
          accept that platform’s own terms in addition to these.
        </p>
        <p>
          Reddit connections use OAuth2 authorization_code with duration=permanent against
          reddit.com / oauth.reddit.com only. You must create your own Reddit app, complete the
          Data API request, and stay inside Reddit rate limits. We do not scrape old.reddit.com.
        </p>
        <p>
          Telegram connections use your own api_id / api_hash from my.telegram.org. The client
          identifies itself as X Relay Studio running on Node — not as official Telegram Desktop.
          Flood waits are honored. Do not use this desk as a userbot farm.
        </p>
        <p>
          Public X profile lookup may use an unofficial mirror (FXTwitter) when enabled. That
          mirror is not the official X API. Production posting should use official X credentials.
        </p>
        <p>
          You are responsible for what you post. We can close a desk that burns a platform, evades
          rate limits, or stores stolen sessions.
        </p>
      </div>
      <p className="mt-8 text-xs text-subtle">
        <Link to="/" className="underline-offset-2 hover:underline">
          Back
        </Link>
        {" · "}
        <Link to="/privacy" className="underline-offset-2 hover:underline">
          Privacy
        </Link>
      </p>
    </main>
  );
}
