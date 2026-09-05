import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TelegramAccount } from "@/lib/telegram/types";

export function SettingsPane({
  account,
  onBack,
  onUnlink,
}: {
  account: TelegramAccount;
  onBack: () => void;
  onUnlink: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center gap-1 px-2">
        <button type="button" onClick={onBack} className="grid size-11 place-items-center" aria-label="Back">
          <ChevronLeft className="size-5" />
        </button>
        <h2 className="text-sm font-medium">Settings</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <section className="rounded-xl bg-[var(--tg-item-hover)] p-4">
          <h3 className="text-sm font-medium">Devices</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            {account.preview
              ? "Preview is local to this studio. Telegram itself has no new device."
              : "This is a website login, not an unofficial Telegram app session. Revoke it in Telegram → Settings → Devices → Connected websites."}
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <h3 className="text-sm font-medium">Notifications</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            Alerts stay in this browser. We do not change Telegram notification settings.
          </p>
        </section>
        <Button
          type="button"
          variant="ghost"
          className="mt-6 h-12 w-full justify-center text-down"
          onClick={onUnlink}
        >
          Disconnect Telegram
        </Button>
        <p className="mt-3 text-xs leading-relaxed text-[var(--tg-text-secondary)]">
          Disconnect Telegram. This studio copy is deleted. Telegram itself is untouched unless you
          also revoke the session in Devices.
        </p>
      </div>
    </div>
  );
}

export function UnlinkDialog({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 text-fg">
        <h2 className="text-lg font-medium">Disconnect Telegram?</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Disconnect Telegram. This studio copy is deleted. Telegram itself is untouched unless you
          also revoke the session in Devices.
        </p>
        <div className="mt-5 grid gap-2">
          <Button type="button" className="h-12 w-full justify-center" disabled={busy} onClick={onConfirm}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </Button>
          <Button type="button" variant="secondary" className="h-12 w-full justify-center" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
