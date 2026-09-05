import { Pin, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { TelegramAccount, TelegramChat, TelegramFolder } from "@/lib/telegram/types";
import { cn } from "@/lib/utils";
import { TgAvatar } from "./avatar";
import { formatChatTime } from "./format";

const FOLDERS: { id: TelegramFolder; label: string }[] = [
  { id: "all", label: "All" },
  { id: "personal", label: "Personal" },
  { id: "saved", label: "Saved" },
];

export function ChatList({
  chats,
  selectedId,
  onSelect,
  query,
  onQuery,
  folder,
  onFolder,
  account,
  onSelf,
}: {
  chats: TelegramChat[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (value: string) => void;
  folder: TelegramFolder;
  onFolder: (folder: TelegramFolder) => void;
  account: TelegramAccount | null;
  onSelf: () => void;
}) {
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => {
      if (folder === "saved" && c.kind !== "notes") return false;
      if (folder === "personal" && c.kind !== "bot") return false;
      if (!q) return true;
      return c.title.toLowerCase().includes(q) || (c.lastPreview ?? "").toLowerCase().includes(q);
    });
  }, [chats, query, folder]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--tg-bg-secondary)]">
      {account ? (
        <button
          type="button"
          onClick={onSelf}
          className="flex h-14 shrink-0 items-center gap-3 border-b border-white/5 px-3 text-left"
        >
          <TgAvatar name={account.displayName} src={account.photoUrl} size="sm" />
          <span className="min-w-0">
            <span className="tg-title block truncate text-[var(--tg-text)]">{account.displayName}</span>
            <span className="block truncate font-mono text-[length:var(--tg-fs-time)] text-[var(--tg-text-secondary)]">
              {account.displayUsername ? `@${account.displayUsername}` : "You"}
            </span>
          </span>
        </button>
      ) : null}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--tg-text-secondary)]" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search"
            className="h-11 w-full rounded-xl bg-[var(--tg-item-hover)] pl-10 pr-3 text-[length:var(--tg-fs-body)] text-[var(--tg-text)] outline-none placeholder:text-[var(--tg-text-secondary)]"
          />
        </label>
        <div className="mt-2 flex gap-1">
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFolder(f.id)}
              className={cn(
                "h-8 rounded-full px-3 text-[length:var(--tg-fs-meta)]",
                folder === f.id
                  ? "bg-[var(--tg-primary)] text-[var(--tg-own-text)]"
                  : "text-[var(--tg-text-secondary)] hover:bg-[var(--tg-item-hover)]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-[var(--tg-text-secondary)]">
            {chats.length === 0
              ? "You’re connected. Private chats with other people stay in Telegram."
              : folder !== "all"
                ? "No chats in this folder."
                : "No chats match."}
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
                      <span className="flex min-w-0 items-center gap-1.5">
                        {chat.pinned ? (
                          <Pin className="size-3 shrink-0 text-[var(--tg-text-secondary)]" aria-hidden />
                        ) : null}
                        <span className="tg-title truncate text-[var(--tg-text)]">{chat.title}</span>
                      </span>
                      <span className="shrink-0 text-[length:var(--tg-fs-time)] text-[var(--tg-text-secondary)]">
                        {formatChatTime(chat.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[length:var(--tg-fs-sub)] text-[var(--tg-text-secondary)]">
                        {chat.lastPreview ?? "No messages yet"}
                      </span>
                      {chat.unread > 0 ? (
                        <span className="grid min-w-5 place-items-center rounded-full bg-[var(--tg-primary)] px-1.5 text-[length:var(--tg-fs-time)] text-[var(--tg-own-text)]">
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
