import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [{ title: "Privacy · X Relay" }],
  }),
});

function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-bg px-4 py-10 text-fg">
      <Logo />
      <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">Privacy</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">How this desk holds data.</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          X Relay is an independent product. It is not affiliated with X, Telegram, or Reddit.
          You open an anonymous 16-digit desk. That number is the account. We do not ask for a
          name or email.
        </p>
        <p>
          Platform tokens (Reddit refresh tokens, Telegram MTProto sessions, helper bot keys)
          are encrypted at rest with AES-256-GCM. Encryption uses BETTER_AUTH_SECRET or
          SECRETS_ENCRYPTION_KEY. Losing that key loses the tokens.
        </p>
        <p>
          We store only what the desk needs: the number, connected accounts, chat snapshots you
          asked us to watch, and rewrite jobs you started. We do not sell data. We do not use
          connected inboxes to train public models.
        </p>
        <p>
          If you lose the number, the desk cannot be recovered. Disconnect a platform from the
          desk to revoke its session. Delete the desk by discarding the number and asking us to
          wipe the row — there is no password reset because there is no email.
        </p>
        <p>
          Questions: use the in-product report path or open a private issue on the repository.
        </p>
      </div>
      <p className="mt-8 text-xs text-subtle">
        <Link to="/" className="underline-offset-2 hover:underline">
          Back
        </Link>
        {" · "}
        <Link to="/terms" className="underline-offset-2 hover:underline">
          Terms
        </Link>
      </p>
    </main>
  );
}
