import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled, signIn } from "@/lib/auth/client";

const ERRORS: Record<string, string> = {
  telegram_login_expired: "Telegram login expired. Start again.",
  telegram_denied: "Telegram login was cancelled.",
  telegram_in_use: "That Telegram account is already linked to another studio user.",
  unauthorized: "Sign in to the studio first.",
  not_configured: "Telegram connect isn’t configured.",
  flood: "Telegram asked us to wait. Try again in a few minutes.",
  bad_key: "That key didn’t work. Copy it again from BotFather.",
};

export function TelegramLoginScreen({
  pending = false,
  error,
}: {
  pending?: boolean;
  error?: string | null;
}) {
  const message = error ? (ERRORS[error] ?? error) : null;

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">Telegram</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">
          Sign in, then connect the Telegram you’ll use here.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          First, sign in to this studio (X or Google). Next you’ll make a small helper in
          Telegram, check that it works, and open your desk. We never see your Telegram
          password.
        </p>

        {message ? (
          <p className="mt-4 text-sm text-down" role="alert">
            {message}
          </p>
        ) : null}

        {pending ? (
          <div className="mt-8 grid gap-3" aria-live="polite" aria-label="Checking session">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ) : authEnabled ? (
          <div className="mt-8 grid gap-3">
            <StudioButton provider="grok-x" label="Continue with X" />
            <StudioButton provider="grok-google" label="Or continue with Google" secondary />
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted">Sign-in is disabled.</p>
        )}

        <p className="mt-8 text-xs leading-relaxed text-subtle">
          Connecting Telegram is a linked identity on your studio user. It does not replace
          studio sign-in.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block text-xs text-subtle transition-colors duration-[var(--motion-quick)] hover:text-fg"
        >
          All platforms
        </Link>
      </div>
    </main>
  );
}

function StudioButton({
  provider,
  label,
  secondary,
}: {
  provider: "grok-x" | "grok-google";
  label: string;
  secondary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant={secondary ? "secondary" : "default"}
      size="lg"
      className="h-12 w-full justify-center text-base"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signIn(provider, { callbackURL: "/telegram" }).catch(() => setBusy(false));
      }}
    >
      {busy ? "Opening…" : label}
    </Button>
  );
}
