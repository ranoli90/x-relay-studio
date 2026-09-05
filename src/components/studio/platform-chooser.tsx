import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { BuySheet } from "@/components/desk/buy-sheet";
import { UserButton } from "@/lib/auth/gates";
import { formatDeskNumber, normalizeDeskNumber } from "@/lib/desk/number";
import { cn } from "@/lib/utils";

function DeskNumberLockup({ deskNumber }: { deskNumber: string }) {
  const digits = normalizeDeskNumber(deskNumber);
  const pretty = formatDeskNumber(digits);
  const first = pretty.slice(0, 9); // "6310 7142"
  const second = pretty.slice(10); // "4599 6624"
  return (
    <p
      className="mt-2 font-mono text-[1.65rem] leading-tight tracking-wide text-fg tabular-nums sm:text-3xl"
      aria-label={`Desk number ${pretty}`}
    >
      <span className="inline-block whitespace-nowrap">{first || pretty}</span>
      {second ? (
        <>
          {" "}
          <span className="inline-block whitespace-nowrap">{second}</span>
        </>
      ) : null}
    </p>
  );
}

export function PlatformChooser({ deskNumber }: { deskNumber: string }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="page-enter w-full max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <Logo />
          <div className="flex items-center gap-2">
            <BuySheet compact />
            <UserButton />
          </div>
        </div>
        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-subtle">
          Your account with us
        </p>
        <p className="mt-3 text-sm text-muted">Desk</p>
        <DeskNumberLockup deskNumber={deskNumber} />
        <h1 className="mt-6 text-3xl font-medium tracking-tight">Pick a platform.</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          That number is the only login we keep. Telegram is the live inbox — you read and send
          yourself. Auto-send lives on the Agents floor and in Settings. X and Reddit stay their
          own accounts.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3 min-[520px]:grid-cols-2">
          <PlatformCard
            to="/telegram"
            label="Telegram"
            kicker="Live inbox"
            description="Your real chats. You read and send from this inbox. Auto-send is on the Agents floor and in Settings."
            icon={<TelegramTile />}
          />
          <PlatformCard
            to="/agents"
            label="Agents"
            kicker="Live floor"
            description="Named AI on the floor. Auto-send, and it keeps running when you leave."
            icon={<AgentsTile />}
          />
          <PlatformCard
            to="/x"
            label="X"
            kicker="Open"
            description="Posting account, sources, rewrite, drip."
            icon={<XTile />}
          />
          <PlatformCard
            to="/reddit"
            label="Reddit"
            kicker="Connect"
            description="Create the Reddit app, Allow, health, then inbox."
            icon={<RedditTile />}
            accent
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
  accent,
}: {
  to: "/x" | "/telegram" | "/reddit" | "/agents";
  label: string;
  kicker: string;
  description: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex min-h-[11rem] flex-col rounded-xl border bg-surface p-5 text-left",
        accent
          ? "border-[#ff4500]/50 hover:bg-[#ff4500]/10"
          : "border-border hover:bg-surface-2",
        "transition-[background-color,border-color,transform] duration-[var(--motion-quick)] ease-[var(--ease-out)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40",
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

function AgentsTile() {
  return (
    <span className="grid size-16 place-items-center rounded-lg bg-surface-2 text-fg" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="7" cy="13" r="2.25" />
        <circle cx="12" cy="7" r="2.25" />
        <circle cx="17" cy="13" r="2.25" />
        <path d="M8.7 11.4 10.5 8.9M13.5 8.9l1.8 2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function TelegramTile() {
  return (
    <span className="grid size-16 place-items-center rounded-lg bg-[#229ED9] text-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-8" fill="currentColor">
        <path d="M21.5 4.2 18.6 20c-.2.9-.8 1.1-1.6.7l-4.4-3.2-2.1 2c-.2.2-.5.5-1 .5l.3-4.5 8.2-7.4c.4-.3 0-.5-.5-.2l-10.1 6.4-4.4-1.4c-.9-.3-.9-.9.2-1.3L20.2 3.4c.8-.3 1.5.2 1.3.8Z" />
      </svg>
    </span>
  );
}

function XTile() {
  return (
    <span className="grid size-16 place-items-center rounded-lg bg-fg text-bg" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-7" fill="currentColor">
        <path d="M14.3 10.5 22 2h-2.2l-6.6 7.4L8 2H2 l8.1 11.5L2 22h2.2l7-7.9L16 22h6l-7.7-11.5ZM12 13.2l-.8-1.1L5 3.6h2.7l5.1 7.1.8 1.1 6.7 9.2h-2.7L12 13.2Z" />
      </svg>
    </span>
  );
}

function RedditTile() {
  return (
    <span
      className="grid size-16 place-items-center rounded-lg"
      style={{ backgroundColor: "#FF4500", color: "#fff7f2" }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="size-9" fill="currentColor">
        <circle cx="12" cy="14" r="7.2" />
        <circle cx="9.2" cy="13.6" r="1.15" fill="#FF4500" />
        <circle cx="14.8" cy="13.6" r="1.15" fill="#FF4500" />
        <circle cx="16.6" cy="6.2" r="1.7" />
        <path d="M12.2 8.4 15.4 6.4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
}
