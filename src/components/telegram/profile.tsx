import { ChevronLeft } from "lucide-react";
import type { TelegramAccount } from "@/lib/telegram/types";
import { Button } from "@/components/ui/button";
import { TgAvatar } from "./avatar";

export function ProfilePane({
  account,
  onBack,
  onEdit,
  onUnlink,
  onSettings,
  showBack,
}: {
  account: TelegramAccount;
  onBack: () => void;
  onEdit: () => void;
  onUnlink: () => void;
  onSettings: () => void;
  showBack: boolean;
}) {
  const username = account.username ? `@${account.username}` : "No username";
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center gap-1 px-2">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className="grid size-11 place-items-center"
            aria-label="Back"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : (
          <span className="px-3 text-sm font-medium">Profile</span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <div className="flex flex-col items-center pt-4">
          <TgAvatar name={account.displayName} src={account.photoUrl} size="lg" />
          <h2 className="mt-4 text-xl font-medium tracking-tight">{account.displayName}</h2>
          <p className="mt-1 font-mono text-xs text-[var(--tg-text-secondary)]">{username}</p>
          {account.preview ? (
            <p className="mt-3 rounded-full bg-[var(--tg-item-hover)] px-3 py-1 text-[11px] uppercase tracking-widest text-[var(--tg-text-secondary)]">
              Preview
            </p>
          ) : null}
        </div>
        {account.replicaAbout ? (
          <p className="mt-6 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            {account.replicaAbout}
          </p>
        ) : (
          <p className="mt-6 text-sm text-[var(--tg-text-secondary)]">No bio yet.</p>
        )}
        <div className="mt-8 grid gap-2">
          <Button type="button" className="h-12 w-full justify-center" onClick={onEdit}>
            Edit
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full justify-center"
            onClick={onSettings}
          >
            Settings
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-full justify-center text-down"
            onClick={onUnlink}
          >
            Sign out of Telegram
          </Button>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-[var(--tg-text-secondary)]">
          Path A identity. Private chats with other people stay in Telegram.
        </p>
      </div>
    </div>
  );
}
