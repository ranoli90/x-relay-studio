import { create } from "zustand";
import {
  telegramEnterPreviewFn,
  telegramMeFn,
  telegramMessagesFn,
  telegramSendFn,
  telegramSetWatchingFn,
  telegramSyncFn,
  telegramUnlinkFn,
  telegramUpdateProfileFn,
} from "./fns";
import type {
  TelegramAccount,
  TelegramChat,
  TelegramFolder,
  TelegramMessage,
  TelegramSnapshot,
} from "./types";

type View = "list" | "chat" | "profile" | "edit" | "settings" | "peer";

type TelegramState = {
  loading: boolean;
  sending: boolean;
  saving: boolean;
  error: string | null;
  snapshot: TelegramSnapshot | null;
  view: View;
  selectedChatId: string | null;
  messages: TelegramMessage[];
  messageCache: Record<string, TelegramMessage[]>;
  messagesLoading: boolean;
  profileOpen: boolean;
  folder: TelegramFolder;
  notify: boolean;
  load: () => Promise<void>;
  sync: () => Promise<void>;
  enterPreview: (displayName: string) => Promise<void>;
  selectChat: (id: string | null) => Promise<void>;
  send: (body: string) => Promise<void>;
  setView: (view: View) => void;
  setProfileOpen: (open: boolean) => void;
  setFolder: (folder: TelegramFolder) => void;
  setNotify: (on: boolean) => void;
  saveProfile: (input: {
    firstName: string;
    lastName: string;
    about: string;
    username?: string;
  }) => Promise<void>;
  unlink: () => Promise<void>;
  setWatching: (watching: boolean) => Promise<void>;
  clearError: () => void;
};

function isAuthError(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

let syncInFlight = false;

function readNotify(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("xrelay-tg-notify") === "1";
}

export const useTelegram = create<TelegramState>((set, get) => ({
  loading: true,
  sending: false,
  saving: false,
  error: null,
  snapshot: null,
  view: "list",
  selectedChatId: null,
  messages: [],
  messageCache: {},
  messagesLoading: false,
  profileOpen: false,
  folder: "all",
  notify: readNotify(),

  setView: (view) => set({ view, error: null }),
  setProfileOpen: (profileOpen) => set({ profileOpen }),
  setFolder: (folder) => set({ folder }),
  clearError: () => set({ error: null }),
  setNotify: (on) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("xrelay-tg-notify", on ? "1" : "0");
      if (on && "Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    }
    set({ notify: on });
  },

  load: async () => {
    const keep = Boolean(get().snapshot?.account);
    if (!keep) set({ loading: true, error: null });
    else set({ error: null });
    try {
      const snapshot = await telegramMeFn();
      set({ snapshot, loading: false });
    } catch (err) {
      if (isAuthError(err)) {
        set({ loading: false, snapshot: null });
        return;
      }
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Could not load Telegram.",
      });
    }
  },

  sync: async () => {
    const { snapshot, selectedChatId, notify, messages } = get();
    if (!snapshot?.account || syncInFlight) return;
    syncInFlight = true;
    try {
      const next = await telegramSyncFn({ data: { chatId: selectedChatId } });
      const prevUnread = (snapshot.chats ?? []).reduce((n, c) => n + (c.unread ?? 0), 0);
      const nextUnread = next.chats.reduce((n, c) => n + (c.unread ?? 0), 0);
      const nextMessages = selectedChatId ? next.messages : messages;
      set({
        snapshot: {
          ...snapshot,
          chats: next.chats,
          watch: next.watch ?? snapshot.watch,
        },
        messages: nextMessages,
        messageCache: selectedChatId
          ? { ...get().messageCache, [selectedChatId]: next.messages }
          : get().messageCache,
      });
      if (
        notify &&
        nextUnread > prevUnread &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const incoming = next.chats.find((c) => c.unread > 0);
        new Notification(incoming?.title ?? "Telegram", {
          body: incoming?.lastPreview ?? "New message",
        });
      }
    } catch {
      // keep last good snapshot
    } finally {
      syncInFlight = false;
    }
  },

  enterPreview: async (displayName) => {
    set({ loading: true, error: null });
    try {
      const snapshot = await telegramEnterPreviewFn({ data: { displayName } });
      set({ snapshot, loading: false, view: "list" });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Could not open preview.",
      });
      throw err;
    }
  },

  selectChat: async (id) => {
    if (!id) {
      set({ selectedChatId: null, view: "list" });
      return;
    }
    const cached = get().messageCache[id];
    set({
      selectedChatId: id,
      view: "chat",
      messages: cached ?? [],
      messagesLoading: !cached,
    });
    try {
      const messages = await telegramMessagesFn({ data: { chatId: id } });
      if (get().selectedChatId !== id) return;
      const chats = (get().snapshot?.chats ?? []).map((chat) =>
        chat.id === id ? { ...chat, unread: 0 } : chat,
      );
      const snapshot = get().snapshot;
      set({
        messages,
        messageCache: { ...get().messageCache, [id]: messages },
        messagesLoading: false,
        snapshot: snapshot ? { ...snapshot, chats } : snapshot,
      });
    } catch (err) {
      if (get().selectedChatId !== id) return;
      set({
        messagesLoading: false,
        error: err instanceof Error ? err.message : "Could not load messages.",
      });
    }
  },

  saveProfile: async (input) => {
    set({ saving: true, error: null });
    try {
      const account = await telegramUpdateProfileFn({ data: input });
      const snapshot = get().snapshot;
      set({
        saving: false,
        snapshot: snapshot ? { ...snapshot, account } : snapshot,
        view: "profile",
      });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : "Could not save profile.",
      });
    }
  },

  send: async (body) => {
    const chatId = get().selectedChatId;
    if (!chatId) return;
    const account = get().snapshot?.account;
    const temp: TelegramMessage = {
      id: `tmp_${Date.now()}`,
      chatId,
      fromSelf: true,
      authorName: account?.displayName ?? "You",
      body: body.trim(),
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    set({ sending: true, error: null, messages: [...get().messages, temp] });
    try {
      const message = await telegramSendFn({ data: { chatId, body } });
      const chats = (get().snapshot?.chats ?? []).map((chat) =>
        chat.id === chatId
          ? { ...chat, lastPreview: message.body.slice(0, 140), lastAt: message.createdAt }
          : chat,
      );
      const snapshot = get().snapshot;
      const nextMessages = [...get().messages.filter((m) => m.id !== temp.id), message];
      set({
        sending: false,
        messages: nextMessages,
        messageCache: { ...get().messageCache, [chatId]: nextMessages },
        snapshot: snapshot ? { ...snapshot, chats } : snapshot,
      });
    } catch (err) {
      set({
        sending: false,
        messages: get().messages.filter((m) => m.id !== temp.id),
        error: err instanceof Error ? err.message : "Could not send.",
      });
    }
  },

  unlink: async () => {
    set({ loading: true, error: null });
    try {
      await telegramUnlinkFn();
      set({
        loading: false,
        snapshot: {
          configured: get().snapshot?.configured ?? false,
          mtprotoEnabled: false,
          onboarded: false,
          account: null,
          chats: [],
          credential: null,
          watch: null,
        },
        view: "list",
        selectedChatId: null,
        messages: [],
        messageCache: {},
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Could not disconnect.",
      });
    }
  },

  setWatching: async (watching) => {
    set({ error: null });
    try {
      const snapshot = await telegramSetWatchingFn({ data: { watching } });
      set({ snapshot });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not change watching." });
    }
  },
}));

export function accountOf(state: TelegramState): TelegramAccount | null {
  return state.snapshot?.account ?? null;
}

export function chatsOf(state: TelegramState): TelegramChat[] {
  return state.snapshot?.chats ?? [];
}
