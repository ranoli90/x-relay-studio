import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadDesk, setAutoSend, setBackgroundRun, setEmergencyStop } from "@/lib/agent/fns";
import { loadOperatorDeskFn, setProcessingPermissionFn } from "@/lib/operator/fns";
import { asFloorDesk } from "@/components/agents/model";
import type { TelegramAccount, TelegramWatch } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";
import { DiagnosticsPane } from "./diagnostics-pane";
import { tgFocusClass } from "./format";

export function SettingsPane({
  account,
  watch,
  notify,
  onNotify,
  onWatching,
  onAutomation,
  onBack,
  onUnlink,
}: {
  account: TelegramAccount;
  watch?: TelegramWatch | null;
  notify: boolean;
  onNotify: (on: boolean) => void;
  onWatching: (on: boolean) => void;
  onAutomation: (on: boolean) => void;
  onBack: () => void;
  onUnlink: () => void;
}) {
  const [autoSend, setAuto] = useState(false);
  const [backgroundRun, setBg] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lab, setLab] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadDesk().catch(() => null), loadOperatorDeskFn().catch(() => null)]).then(
      ([deskRaw, op]) => {
        if (cancelled) return;
        if (deskRaw) {
          const desk = asFloorDesk(deskRaw);
          setAuto(Boolean(desk.persona.autoSend));
          setBg(Boolean(desk.persona.backgroundRun));
          setEmergency(Boolean(desk.persona.emergencyStop));
        }
        if (op) {
          setProcessing(op.flags.processingPermission);
          setEmergency(op.flags.emergencyStop);
          setAuto(op.autoSend);
          setBg(op.backgroundRun);
          setLab(op.labAllowed);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(label: string, fn: () => Promise<unknown>, revert: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      revert();
      setError(err instanceof Error ? err.message : `Could not update ${label}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          onClick={onBack}
          className={cn("grid size-11 min-h-[44px] min-w-[44px] place-items-center", tgFocusClass)}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h2 className="text-sm font-medium">Settings</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <section className="rounded-xl bg-[var(--tg-item-hover)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Watching</h3>
            <TgSwitch
              label="Watching"
              checked={Boolean(watch?.watching)}
              disabled={account.preview || busy}
              onChange={(on) => void onWatching(on)}
            />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            {account.preview
              ? "Preview is local. Telegram itself is not connected."
              : `Store chats on this desk. Watching is not permission to write. ${watch?.chatsWatched || 0} chats stored.`}
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
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Draft replies</h3>
            <TgSwitch
              label="Draft replies"
              checked={Boolean(watch?.automationArmed)}
              disabled={account.preview || busy}
              onChange={(on) => void onAutomation(on)}
            />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            {account.preview
              ? "Preview is local. Nothing is sent to a model."
              : "Let the assistant draft from stored inbound. This is not send permission."}
          </p>
          <p className="mt-2 font-mono text-xs text-[var(--tg-text-secondary)]">
            {watch?.pendingForAi ?? 0} queued for drafting
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Processing permission</h3>
            <TgSwitch
              label="Processing permission"
              checked={processing}
              disabled={account.preview || busy}
              onChange={(on) => {
                setProcessing(on);
                void run("processing permission", () => setProcessingPermissionFn({ data: { on } }), () =>
                  setProcessing(!on),
                );
              }}
            />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            Scoped permission for this desk to run the model on stored chats. Off by default.
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Auto-send</h3>
            <TgSwitch
              label="Auto-send"
              checked={autoSend && !emergency}
              disabled={account.preview || busy || emergency}
              onChange={(on) => {
                setAuto(on);
                void run("auto-send", () => setAutoSend({ data: { on } }), () => setAuto(!on));
              }}
            />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            {account.preview
              ? "Preview is local. Nothing is auto-sent."
              : "Send only after a live permission check at the transport boundary. Local approval is not a customer message."}
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Keep running when I leave</h3>
            <TgSwitch
              label="Keep running when I leave"
              checked={backgroundRun && !emergency}
              disabled={account.preview || busy || emergency}
              onChange={(on) => {
                setBg(on);
                void run("background run", () => setBackgroundRun({ data: { on } }), () => setBg(!on));
              }}
            />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            {account.preview
              ? "Preview is local. The desk does not run in the background."
              : "Keep watching and draining after this tab closes. Stop still wins."}
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Stop</h3>
            <TgSwitch
              label="Emergency stop"
              checked={emergency}
              disabled={busy}
              onChange={(on) => {
                setEmergency(on);
                if (on) {
                  setAuto(false);
                }
                void run("stop", () => setEmergencyStop({ data: { on } }), () => setEmergency(!on));
              }}
            />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            Immediate halt. In-flight work is rechecked before anything is treated as sent.
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <h3 className="text-sm font-medium">Offers and payment</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            Public offers live under Business. Workspace thread credits never settle a customer
            quote.
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Notifications</h3>
            <TgSwitch label="Notifications" checked={notify} onChange={onNotify} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
            Alerts stay in this browser. We do not change Telegram notification settings.
          </p>
        </section>
        <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
          <h3 className="text-sm font-medium">Identity</h3>
          <p className="mt-2 font-mono text-xs text-[var(--tg-text-secondary)]">
            Account {account.telegramUserId}
          </p>
          <p className="mt-2 text-sm text-[var(--tg-text-secondary)]">
            Replies that go out still name this as an AI assistant when the partner asks.
          </p>
        </section>
        {error ? (
          <p className="mt-3 text-sm text-down" role="alert">
            {error}
          </p>
        ) : null}
        {lab ? (
          <div className="mt-3 overflow-hidden rounded-xl">
            <DiagnosticsPane />
          </div>
        ) : null}
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

function TgSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "grid h-11 min-h-[44px] w-12 place-items-center disabled:opacity-40",
        tgFocusClass,
      )}
    >
      <span
        className={cn(
          "relative h-7 w-12 rounded-full p-0.5 transition-colors",
          checked ? "bg-[var(--tg-primary)]" : "bg-[var(--tg-item-active)]",
        )}
      >
        <span
          className={`block size-6 rounded-full bg-[var(--tg-own-text)] transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
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
