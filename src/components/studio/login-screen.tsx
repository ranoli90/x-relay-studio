import { useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled, signIn } from "@/lib/auth/client";

export function LoginScreen({ pending = false }: { pending?: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-md">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">X Relay</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">
          Sign in the account you’ll post with.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          That’s the only login. Source accounts are public — you’ll paste handles
          next, and we take the full archive of each. No password for those. No
          “how many posts” prompt. Always all.
        </p>

        {pending ? (
          <div className="mt-8 grid gap-3" aria-live="polite" aria-label="Checking session">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ) : authEnabled ? (
          <div className="mt-8 grid gap-3">
            <XButton />
            <GoogleButton />
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted">Sign-in is disabled.</p>
        )}

        <p className="mt-8 text-xs leading-relaxed text-subtle">
          We never ask for an X password. Sign in with X proves the posting identity.
          If you manage a brand you don’t log into here, use Google, then confirm the
          posting handle.
        </p>
      </div>
    </main>
  );
}

function XButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg"
      className="h-12 w-full justify-center text-base"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signIn("grok-x", { callbackURL: "/" }).catch(() => setBusy(false));
      }}
    >
      <XMark />
      {busy ? "Opening X…" : "Continue with X"}
    </Button>
  );
}

function GoogleButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="lg"
      className="h-12 w-full justify-center"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signIn("grok-google", { callbackURL: "/" }).catch(() => setBusy(false));
      }}
    >
      {busy ? "Opening Google…" : "Or continue with Google"}
    </Button>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" fill="currentColor">
      <path d="M14.3 10.5 22 2h-2.2l-6.6 7.4L8 2H2l8.1 11.5L2 22h2.2l7-7.9L16 22h6l-7.7-11.5ZM12 13.2l-.8-1.1L5 3.6h2.7l5.1 7.1.8 1.1 6.7 9.2h-2.7L12 13.2Z" />
    </svg>
  );
}
