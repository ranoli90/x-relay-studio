import { useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TelegramAccount, TelegramWatch } from "@/lib/telegram/types";

export function SettingsPane({
  account,
  watch,
  notify,
  onNotify,
  onWatching,
  onBack,
  onUnlink,
}: {
  account: TelegramAccount;
  watch?: TelegramWatch | null;
  notify: boolean;
  onNotify: (on: boolean) => void;
  onWatching: (on: boolean) => void;
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
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Watching</h3>
            {account.preview ? null : (
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(watch?.watching)}
                onClick={() => onWatching(!watch?.watching)}
                className={`h-7 w-12 rounded-full p-0.5 transition-colors ${
                  watch?.watching ? "bg-[var(--tg-primary)]" : "bg-[var(--tg-item-active)]"
                }`}
              >
                <span
                  className={`block size-6 rounded-full bg-[var(--tg-own-text)] transition-transform ${
                    watch?.watching ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            {account.preview
              ? "Preview is local. Telegram itself is not connected."
              : watch?.watching
                ? `On. ${watch.chatsWatched || 0} chats, ${watch.messagesIngested || 0} messages stored.`
                : "Paused. Turn it on to keep pulling your real chats."}
          </p>
          {watch?.lastError && (watch.chatsWatched || 0) === 0 ? (
            <p className="mt-2 text-sm text-down">{watch.lastError}</p>
          ) : watch?.lastError ? (
            <p className="mt-2 text-sm text-[var(--tg-text-secondary)]">
              Last live refresh missed. Chats already on this desk stay here.
            </p>
          ) : null}
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <h3 className="text-sm font-medium">Automation</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            Not started. Watching queues messages. The decision layer is not connected yet.
          </p>
          <p className="mt-2 font-mono text-xs text-[var(--tg-text-secondary)]">
            {watch?.pendingForAi ?? 0} queued
          </p>
          <button
            type="button"
            disabled
            className="mt-3 h-10 w-full rounded-md border border-border text-sm text-[var(--tg-text-secondary)] opacity-50"
          >
            Start automation
          </button>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <h3 className="text-sm font-medium">OpenRouter</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            Already set for this product. Nothing is sent until you start automation.
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <h3 className="text-sm font-medium">Devices</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            {account.preview
              ? "Preview is local to this studio. Telegram itself has no new device."
              : "This desk is a new device on your Telegram. Revoke it in Telegram → Settings → Devices."}
          </p>
          {watch?.phoneHint ? (
            <p className="mt-2 font-mono text-xs text-[var(--tg-text-secondary)]">{watch.phoneHint}</p>
          ) : null}
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Notifications</h3>
            <button
              type="button"
              role="switch"
              aria-checked={notify}
              onClick={() => onNotify(!notify)}
              className={`h-7 w-12 rounded-full p-0.5 transition-colors ${
                notify ? "bg-[var(--tg-primary)]" : "bg-[var(--tg-item-active)]"
              }`}
            >
              <span
                className={`block size-6 rounded-full bg-[var(--tg-own-text)] transition-transform ${
                  notify ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            Alerts stay in this browser. We do not change Telegram notification settings.
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <h3 className="text-sm font-medium">Identity</h3>
          <p className="mt-2 font-mono text-xs text-[var(--tg-text-secondary)]">
            telegram {account.telegramUserId}
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
          Disconnect Telegram. This studio copy is deleted. Also revoke the device in Telegram if
          you want the session gone there too.
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-bg p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlink-title"
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 text-fg"
      >
        <h2 id="unlink-title" className="text-lg font-medium">
          Disconnect Telegram?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Disconnect Telegram. This studio copy is deleted. Also revoke the device in Telegram if
          you want the session gone there too.
        </p>
        <div className="mt-5 grid gap-2">
          <Button type="button" className="h-12 w-full justify-center" disabled={busy} onClick={onConfirm}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full justify-center"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}