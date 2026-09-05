import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

export function PlatformChooser() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-xl">
        <Logo />
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">X Relay</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Choose your platform.</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          Same desk, two doors. X is open now. Telegram is reserved for a later
          tool — nothing runs there yet.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <PlatformCard
            to="/x"
            label="X"
            kicker="Open"
            description="Sign in the posting account, assign public sources, rewrite, and drip."
            icon={<XTile />}
          />
          <PlatformCard
            to="/telegram"
            label="Telegram"
            kicker="Later"
            description="A new desk for this shop. Prepared, not built."
            icon={<TelegramTile />}
          />
        </div>
      </div>
    </main>
  );
}

function PlatformCard({
  to,
  label,
  kicker,
  description,
  icon,
}: {
  to: "/x" | "/telegram";
  label: string;
  kicker: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex flex-col rounded-xl border border-border bg-surface p-5 text-left",
        "transition-[background-color,border-color,transform] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
        "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40",
        "active:scale-[0.99]",
      )}
    >
      {icon}
      <p className="mt-5 font-mono text-xs uppercase tracking-widest text-subtle">{kicker}</p>
      <h2 className="mt-2 text-xl font-medium tracking-tight">{label}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
    </Link>
  );
}

function XTile() {
  return (
    <span className="grid size-16 place-items-center rounded-lg bg-fg text-bg" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-7" fill="currentColor">
        <path d="M14.3 10.5 22 2h-2.2l-6.6 7.4L8 2H2l8.1 11.5L2 22h2.2l7-7.9L16 22h6l-7.7-11.5ZM12 13.2l-.8-1.1L5 3.6h2.7l5.1 7.1.8 1.1 6.7 9.2h-2.7L12 13.2Z" />
      </svg>
    </span>
  );
}

function TelegramTile() {
  return (
    <span className="block size-16 overflow-hidden rounded-lg bg-fg" aria-hidden="true">
      <img
        src="/telegram-mark.jpg"
        alt=""
        width={64}
        height={64}
        className="size-16 object-cover outline outline-1 -outline-offset-1 outline-fg/10"
      />
    </span>
  );
}
