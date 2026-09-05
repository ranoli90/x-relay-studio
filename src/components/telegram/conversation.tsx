import { Check, ChevronLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import type { TelegramChat, TelegramMessage } from "@/lib/telegram/types";
import { mediaLabel, isServicePeer } from "@/lib/telegram/preview";
import { cn } from "@/lib/utils";
import { TgAvatar } from "./avatar";
import { Composer } from "./composer";
import { formatChatTime, formatDayLabel, sameDay, tgFocusClass } from "./format";

export function Conversation({
  chat,
  messages,
  loading,
  sending,
  draft,
  onDraft,
  onBack,
  onProfile,
  onSend,
  showBack,
}: {
  chat: TelegramChat | null;
  messages: TelegramMessage[];
  loading: boolean;
  sending: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onBack: () => void;
  onProfile: () => void;
  onSend: (body: string) => void | Promise<boolean | void>;
  showBack: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const hasSendingMsg = messages.some((m) => m.status === "sending");

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.id]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    if (!nearBottom) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages.length, sending]);

  if (!chat) {
    return (
      <div className="grid h-full place-items-center bg-[var(--tg-bg)] text-sm text-[var(--tg-text-secondary)]">
        Select a chat
      </div>
    );
  }

  const service = isServicePeer(chat.peerId);
  const writable = !service && (chat.kind === "notes" || chat.kind === "user");
  const showAuthor = chat.kind !== "user";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-[var(--tg-bg)]">
      <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 border-b border-white/5 px-2">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className={cn("grid size-11 min-h-[44px] min-w-[44px] place-items-center text-[var(--tg-text)]", tgFocusClass)}
            aria-label="Back"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onProfile}
          className={cn(
            "flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left",
            tgFocusClass,
          )}
        >
          <TgAvatar name={chat.title} src={chat.photoUrl} size="sm" />
          <span className="min-w-0">
            <span className="tg-title block truncate text-[var(--tg-text)]">{chat.title}</span>
            <span className="block truncate text-[length:var(--tg-fs-time)] text-[var(--tg-text-secondary)]">
              {chat.kind === "notes"
                ? "Saved in this studio"
                : chat.kind === "user"
                ? service
                  ? "Telegram service"
                  : "Tap for info"
                : "Telegram"}
            </span>
          </span>
        </button>
      </header>
      <div ref={scroller} className="tg-thread min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3">
        {loading && messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--tg-text-secondary)]">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--tg-text-secondary)]">
            {chat.kind === "notes"
              ? "Studio notes live here. Telegram itself is unchanged."
              : chat.kind === "user"
                ? "No messages in this thread yet."
                : "No messages yet."}
          </p>
        ) : (
          messages.map((msg, i) => {
            const prev = messages[i - 1];
            const dayBreak = !prev || !sameDay(prev.createdAt, msg.createdAt);
            return (
              <div key={msg.id}>
                {dayBreak ? (
                  <p className="my-3 text-center text-[length:var(--tg-fs-time)] text-[var(--tg-text-secondary)]">
                    {formatDayLabel(msg.createdAt)}
                  </p>
                ) : null}
                <div className={cn("mb-1.5 flex", msg.fromSelf ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[min(100%,28rem)] rounded-2xl px-3 py-2 leading-snug",
                      "text-[length:var(--tg-fs-body)]",
                      msg.fromSelf
                        ? "rounded-br-md bg-[var(--tg-own-bubble)] text-[var(--tg-own-text)]"
                        : "rounded-bl-md bg-[var(--tg-item-hover)] text-[var(--tg-text)]",
                    )}
                  >
                    {showAuthor && !msg.fromSelf ? (
                      <p className="mb-0.5 text-[length:var(--tg-fs-time)] font-medium text-[var(--tg-primary)]">
                        {msg.authorName}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{mediaLabel(msg.body)}</p>
                    <p
                      className={cn(
                        "mt-1 flex items-center justify-end gap-1 text-[length:var(--tg-fs-time)]",
                        msg.fromSelf ? "text-[var(--tg-tick)]" : "text-[var(--tg-text-secondary)]",
                      )}
                    >
                      {msg.status === "sending" ? (
                        <>
                          Sending
                          <SendingDots />
                        </>
                      ) : (
                        <>
                          {formatChatTime(msg.createdAt)}
                          {msg.fromSelf ? <Check className="size-3" aria-label="Sent" /> : null}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {sending && !hasSendingMsg ? (
          <div className="mb-1.5 flex justify-end">
            <div className="rounded-2xl rounded-br-md bg-[var(--tg-own-bubble)] px-3 py-2 text-[var(--tg-own-text)]">
              <span className="sr-only">Sending</span>
              <SendingDots bright />
            </div>
          </div>
        ) : null}
      </div>
      <Composer
        disabled={sending || !writable}
        kind={chat.kind}
        draft={draft}
        onDraft={onDraft}
        onSend={onSend}
      />
    </div>
  );
}

function SendingDots({ bright }: { bright?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      <span
        className={cn(
          "floor-typing-dot size-1 rounded-full",
          bright ? "bg-[var(--tg-own-text)]" : "bg-[var(--tg-tick)]",
        )}
      />
      <span
        className={cn(
          "floor-typing-dot size-1 rounded-full",
          bright ? "bg-[var(--tg-own-text)]" : "bg-[var(--tg-tick)]",
        )}
      />
      <span
        className={cn(
          "floor-typing-dot size-1 rounded-full",
          bright ? "bg-[var(--tg-own-text)]" : "bg-[var(--tg-tick)]",
        )}
      />
    </span>
  );
}
