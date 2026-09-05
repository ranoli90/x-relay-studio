import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled, signIn } from "@/lib/auth/client";
import { telegramStartOidcFn } from "@/lib/telegram/fns";
import type { TelegramStatus } from "@/lib/telegram/types";

const ERRORS: Record<string, string> = {
  telegram_login_expired: "Telegram login expired. Start again.",
  telegram_denied: "Telegram login was cancelled.",
  telegram_in_use: "That Telegram account is already linked to another studio user.",
  unauthorized: "Sign in to the studio first.",
  not_configured: "Telegram connect isn’t configured.",
  flood: "Telegram asked us to wait. Try again in a few minutes.",
};

export function TelegramLoginScreen({
  pending = false,
  signedIn = false,
  status,
  displayName,
  error,
  onPreview,
}: {
  pending?: boolean;
  signedIn?: boolean;
  status: TelegramStatus | null;
  displayName?: string;
  error?: string | null;
  onPreview: () => void;
}) {
  const message = error ? (ERRORS[error] ?? error) : null;
  const configured = status?.configured ?? false;

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">Telegram</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">
          Sign in the Telegram account you’ll use here.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {signedIn
            ? "Telegram confirms. We never see your cloud password. This is not the official Telegram app. Revoke anytime in Telegram → Settings → Devices (or Connected websites)."
            : "First, sign in to this studio (X or Google). Then Telegram confirms the account you’ll use here."}
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
        ) : !signedIn ? (
          authEnabled ? (
            <div className="mt-8 grid gap-3">
              <StudioButton provider="grok-x" label="Continue with X" />
              <StudioButton provider="grok-google" label="Or continue with Google" secondary />
            </div>
          ) : (
            <p className="mt-8 text-sm text-muted">Sign-in is disabled.</p>
          )
        ) : (
          <div className="mt-8 grid gap-3">
            <TelegramConnectButton configured={configured} />
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="h-12 w-full justify-center"
              onClick={onPreview}
            >
              Preview the desk
            </Button>
            {!configured ? (
              <p className="text-xs leading-relaxed text-subtle">
                Telegram connect isn’t configured. Preview opens a local replica of the desk —
                it is not your Telegram account.
              </p>
            ) : null}
          </div>
        )}

        <p className="mt-8 text-xs leading-relaxed text-subtle">
          Connecting Telegram is a linked identity on your studio user
          {displayName ? ` (${displayName})` : ""}. It does not replace studio sign-in.
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

function TelegramConnectButton({ configured }: { configured: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        size="lg"
        className="h-12 w-full justify-center text-base"
        disabled={!configured || busy}
        onClick={() => {
          setBusy(true);
          setErr(null);
          void telegramStartOidcFn()
            .then(({ url }) => {
              window.location.href = url;
            })
            .catch((e: unknown) => {
              setBusy(false);
              setErr(e instanceof Error ? e.message : "Could not start Telegram login.");
            });
        }}
      >
        {busy ? "Opening Telegram…" : "Continue with Telegram"}
      </Button>
      {err ? <p className="text-xs text-down">{err}</p> : null}
    </div>
  );
}

