import { Check, ChevronLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import type { TelegramChat, TelegramMessage } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";
import { TgAvatar } from "./avatar";
import { Composer } from "./composer";
import { formatChatTime, formatDayLabel, sameDay } from "./format";

export function Conversation({
  chat,
  messages,
  loading,
  sending,
  onBack,
  onProfile,
  onSend,
  showBack,
}: {
  chat: TelegramChat | null;
  messages: TelegramMessage[];
  loading: boolean;
  sending: boolean;
  onBack: () => void;
  onProfile: () => void;
  onSend: (body: string) => void;
  showBack: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, chat?.id]);

  if (!chat) {
    return (
      <div className="grid h-full place-items-center bg-[var(--tg-bg)] text-sm text-[var(--tg-text-secondary)]">
        Select a chat
      </div>
    );
  }

  const writable = chat.kind === "notes" || chat.kind === "bot";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg)]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/5 px-2">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className="grid size-11 place-items-center text-[var(--tg-text)]"
            aria-label="Back"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onProfile}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left"
        >
          <TgAvatar name={chat.title} src={chat.photoUrl} size="sm" />
          <span className="min-w-0">
            <span className="tg-title block truncate text-[var(--tg-text)]">{chat.title}</span>
            <span className="block truncate text-[length:var(--tg-fs-time)] text-[var(--tg-text-secondary)]">
              {chat.kind === "notes" ? "Saved in this studio" : "Helper · Telegram"}
            </span>
          </span>
        </button>
      </header>
      <div ref={scroller} className="tg-thread min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--tg-text-secondary)]">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--tg-text-secondary)]">
            {chat.kind === "notes"
              ? "Studio notes live here. Telegram itself is unchanged."
              : "No messages yet. Open the helper in Telegram or write as the helper."}
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
                    {!msg.fromSelf ? (
                      <p className="mb-0.5 text-[length:var(--tg-fs-time)] font-medium text-[var(--tg-primary)]">
                        {msg.authorName}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                    <p
                      className={cn(
                        "mt-1 flex items-center justify-end gap-1 text-[length:var(--tg-fs-time)]",
                        msg.fromSelf ? "text-[var(--tg-tick)]" : "text-[var(--tg-text-secondary)]",
                      )}
                    >
                      {formatChatTime(msg.createdAt)}
                      {msg.fromSelf ? (
                        <Check
                          className={cn("size-3", msg.status === "sending" ? "opacity-40" : "")}
                          aria-label={msg.status === "sending" ? "Sending" : "Sent"}
                        />
                      ) : null}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <Composer disabled={sending || !writable} kind={chat.kind} onSend={onSend} />
    </div>
  );
}
