import { ChevronLeft } from "lucide-react";
import type { TelegramChat } from "@/lib/telegram/types";
import { isServicePeer } from "@/lib/telegram/preview";
import { cn } from "@/lib/utils";
import { TgAvatar } from "./avatar";
import { tgFocusClass } from "./format";

export function PeerProfile({
  chat,
  showBack,
  onBack,
}: {
  chat: TelegramChat;
  credential?: unknown;
  showBack: boolean;
  onBack: () => void;
}) {
  const notes = chat.kind === "notes";
  const service = isServicePeer(chat.peerId);

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
          <span className="px-3 text-sm font-medium">Info</span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <div className="flex flex-col items-center pt-4">
          <TgAvatar name={chat.title} src={chat.photoUrl} size="lg" />
          <h2 className="mt-4 text-xl font-medium tracking-tight">{chat.title}</h2>
          <p className="mt-1 font-mono text-xs text-[var(--tg-text-secondary)]">
            {notes ? "Studio notes" : service ? "Telegram service" : "Telegram"}
          </p>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-[var(--tg-text-secondary)]">
          {notes
            ? "Saved in this studio. Your Telegram profile and chats were not changed."
            : service
              ? "Official Telegram messages. This thread is read-only here."
              : "This is a real chat from your Telegram. Messages here are yours."}
        </p>
      </div>
    </div>
  );
}