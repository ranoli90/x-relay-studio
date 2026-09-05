import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { Plus, Shield } from "lucide-react";
import { useMemo, useState } from "react";
import { UserButton } from "@/lib/auth/gates";
import type { RedditAccountPublic } from "@/lib/reddit/types";
import { disconnectAccount } from "@/lib/reddit/server";
import { Button } from "@/components/ui/button";
import { AddAccount } from "./add-account";
import { InboxView } from "./inbox-view";
import { cn } from "@/lib/utils";

export function Dashboard({
  accounts,
  onChanged,
}: {
  accounts: RedditAccountPublic[];
  onChanged: () => void;
}) {
  const ready = accounts.filter((a) => a.onboardedAt);
  const [activeId, setActiveId] = useState(ready[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const account = ready.find((a) => a.id === activeId) ?? ready[0] ?? null;

  const age = useMemo(() => {
    if (!account?.createdUtc) return "—";
    try {
      return formatDistanceToNowStrict(new Date(account.createdUtc * 1000));
    } catch {
      return "—";
    }
  }, [account?.createdUtc]);

  if (adding) {
    return (
      <div className="min-h-dvh bg-bg">
        <Topbar />
        <AddAccount
          additional
          onConnected={() => {
            setAdding(false);
            onChanged();
          }}
        />
        <div className="mx-auto max-w-xl px-5 pb-12">
          <Button variant="ghost" type="button" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="min-h-dvh bg-bg">
        <Topbar />
        <AddAccount additional onConnected={onChanged} />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <Topbar />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col md:flex-row">
        <aside className="border-b border-line md:w-64 md:border-r md:border-b-0">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
              Accounts
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>
          <ul>
            {ready.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(a.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left",
                    a.id === account.id ? "bg-lift" : "hover:bg-lift/50",
                  )}
                >
                  <Avatar name={a.name} src={a.iconImg} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">u/{a.name}</span>
                    <span className="block font-mono text-[10px] tracking-wider text-subtle uppercase">
                      {a.healthOk ? "clear" : "watch"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      a.healthOk ? "bg-ok" : "bg-warn",
                    )}
                  />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <section className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            <Stat label="Post karma" value={fmt(account.linkKarma)} />
            <Stat label="Comment karma" value={fmt(account.commentKarma)} />
            <Stat label="Age" value={age} />
            <Stat
              label="Standing"
              value={account.healthOk ? "Clear" : "Watch"}
              tone={account.healthOk ? "ok" : "warn"}
            />
          </section>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
            <p className="flex items-center gap-2 text-xs text-muted">
              <Shield className="size-3.5" />
              Read-only inbox. Classic messages, comment replies, mentions.
              Reddit Chat is not in this API.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!confirm(`Disconnect u/${account.name}? We revoke the token.`)) return;
                void disconnectAccount({ data: { accountId: account.id } }).then(onChanged);
              }}
            >
              Disconnect
            </Button>
          </div>
          <InboxView accountId={account.id} />
        </main>
      </div>
    </div>
  );
}

function Topbar() {
  return (
    <header className="flex items-center justify-between border-b border-line px-4 py-3">
      <div>
        <p className="font-mono text-[11px] tracking-[0.2em] text-muted uppercase">
          Reddit
        </p>
        <Link
          to="/"
          className="text-xs text-subtle hover:text-fg"
        >
          All platforms
        </Link>
      </div>
      <UserButton />
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="bg-bg px-4 py-3">
      <p className="font-mono text-[10px] tracking-[0.16em] text-subtle uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-lg tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="size-8 rounded-full bg-lift object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className="grid size-8 place-items-center rounded-full bg-lift font-mono text-xs text-muted">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(n);
}
