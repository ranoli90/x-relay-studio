import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { TelegramChat } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";
import { TgAvatar } from "./avatar";
import { formatChatTime } from "./format";

export function ChatList({
  chats,
  selectedId,
  onSelect,
  query,
  onQuery,
}: {
  chats: TelegramChat[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (value: string) => void;
}) {
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) => c.title.toLowerCase().includes(q) || (c.lastPreview ?? "").toLowerCase().includes(q),
    );
  }, [chats, query]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)]">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--tg-text-secondary)]" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search"
            className="h-11 w-full rounded-xl bg-[var(--tg-item-hover)] pl-10 pr-3 text-[15px] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-secondary)]"
          />
        </label>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-[var(--tg-text-secondary)]">
            No chats match.
          </li>
        ) : (
          visible.map((chat) => {
            const active = chat.id === selectedId;
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  onClick={() => onSelect(chat.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-[var(--motion-quick)]",
                    active ? "bg-[var(--tg-item-active)]" : "hover:bg-[var(--tg-item-hover)]",
                  )}
                >
                  <TgAvatar name={chat.title} src={chat.photoUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[16px] font-medium text-[var(--tg-text)]">
                        {chat.title}
                      </span>
                      <span className="shrink-0 text-[12px] text-[var(--tg-text-secondary)]">
                        {formatChatTime(chat.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--tg-text-secondary)]">
                        {chat.lastPreview ?? "No messages yet"}
                      </span>
                      {chat.unread > 0 ? (
                        <span className="grid min-w-5 place-items-center rounded-full bg-[var(--tg-primary)] px-1.5 text-[11px] text-white">
                          {chat.unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

export function useChatQuery() {
  const [query, setQuery] = useState("");
  return { query, setQuery };
}
