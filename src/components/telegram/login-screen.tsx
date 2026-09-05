import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";

const ERRORS: Record<string, string> = {
  telegram_login_expired: "That login code expired. Send a new one.",
  telegram_denied: "Telegram login was cancelled.",
  telegram_in_use: "That Telegram account is already linked to another desk.",
  unauthorized: "Open a desk first.",
  not_configured: "Telegram connect isn’t configured yet.",
  flood: "Telegram asked us to wait. Try again in a few minutes.",
  bad_key: "That didn’t work. Try again.",
  password: "This account uses a cloud password.",
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
          Open a desk, then connect your Telegram.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          You’ll sign in as yourself — the account you already use. We watch your real chats so they
          show up in this inbox. You send. This is not a bot.
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
        ) : (
          <Link
            to="/"
            className="mt-8 flex h-12 w-full items-center justify-center rounded-md bg-accent text-base font-medium text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40"
          >
            Open a desk
          </Link>
        )}
      </div>
    </main>
  );
}
