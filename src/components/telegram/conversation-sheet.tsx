import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { loadOperatorDeskFn, setPartnerOptOutFn, setTakeoverFn } from "@/lib/operator/fns";
import { formatMoney } from "@/lib/operator/money";
import type { TelegramChat } from "@/lib/telegram/types";
import { isServicePeer } from "@/lib/telegram/preview";
import { cn } from "@/lib/utils";
import { TgAvatar } from "./avatar";
import { tgFocusClass } from "./format";

export function ConversationSheet({
  chat,
  showBack,
  onBack,
}: {
  chat: TelegramChat;
  showBack: boolean;
  onBack: () => void;
}) {
  const notes = chat.kind === "notes";
  const service = isServicePeer(chat.peerId);
  const [takeover, setTakeover] = useState(chat.muted);
  const [optOut, setOptOut] = useState(false);
  const [about, setAbout] = useState<string | null>(null);
  const [offerLine, setOfferLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadOperatorDeskFn()
      .then((desk) => {
        if (cancelled) return;
        if (desk.projection) {
          setAbout(desk.projection.about);
          const o = desk.projection.offers[0];
          if (o) setOfferLine(`${o.title} ${formatMoney(o.amount)}`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chat.id]);

  async function toggleTakeover(on: boolean) {
    setBusy(true);
    setTakeover(on);
    try {
      await setTakeoverFn({ data: { conversationId: chat.id, on } });
    } catch {
      setTakeover(!on);
    } finally {
      setBusy(false);
    }
  }

  async function toggleOptOut(on: boolean) {
    setBusy(true);
    setOptOut(on);
    try {
      await setPartnerOptOutFn({ data: { conversationId: chat.id, on } });
    } catch {
      setOptOut(!on);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)] text-[var(--tg-text)]">
      <header className="flex h-14 shrink-0 items-center gap-1 px-2">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className={cn("grid size-11 min-h-[44px] min-w-[44px] place-items-center", tgFocusClass)}
            aria-label="Back"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : (
          <span className="px-3 text-sm font-medium">Chat</span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <div className="flex flex-col items-center pt-4">
          <TgAvatar name={chat.title} src={chat.photoUrl} size="lg" />
          <h2 className="mt-4 text-xl font-medium tracking-tight">{chat.title}</h2>
          <p className="mt-1 font-mono text-xs text-[var(--tg-text-secondary)]">
            {notes ? "Studio notes" : service ? "Telegram service" : "Customer"}
          </p>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
          {notes
            ? "Local notes stay on this desk. They are not a message to a customer."
            : service
              ? "Official Telegram messages. This thread is read-only here."
              : "Customer details stay with this chat. Routing scores live in Diagnostics."}
        </p>
        {about ? (
          <section className="mt-4 rounded-xl bg-[var(--tg-item-hover)] p-4">
            <h3 className="text-sm font-medium">Assistant context</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--tg-text-secondary)]">{about}</p>
            {offerLine ? <p className="mt-2 text-sm">{offerLine}</p> : null}
          </section>
        ) : null}
        {notes || service ? null : (
          <>
            <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">I am taking this chat</h3>
                <SheetSwitch
                  label="Take over this chat"
                  checked={takeover}
                  disabled={busy}
                  onChange={(on) => void toggleTakeover(on)}
                />
              </div>
              <p className="mt-2 text-sm text-[var(--tg-text-secondary)]">
                The assistant will not send while you have this chat.
              </p>
            </section>
            <section className="mt-3 rounded-xl bg-[var(--tg-item-hover)] p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">They asked to stop</h3>
                <SheetSwitch
                  label="Partner asked to stop"
                  checked={optOut}
                  disabled={busy}
                  onChange={(on) => void toggleOptOut(on)}
                />
              </div>
              <p className="mt-2 text-sm text-[var(--tg-text-secondary)]">
                Opt-out is remembered. The assistant will not write to them.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SheetSwitch({
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
      className={cn("grid h-11 min-h-[44px] w-12 place-items-center disabled:opacity-40", tgFocusClass)}
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
