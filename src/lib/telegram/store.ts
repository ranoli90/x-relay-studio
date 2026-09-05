import { create } from "zustand";
import {
  telegramEnterPreviewFn,
  telegramMeFn,
  telegramMessagesFn,
  telegramSendFn,
  telegramUnlinkFn,
  telegramUpdateProfileFn,
} from "./fns";
import type { TelegramAccount, TelegramChat, TelegramMessage, TelegramSnapshot } from "./types";

type View = "list" | "chat" | "profile" | "edit" | "settings";

type TelegramState = {
  loading: boolean;
  sending: boolean;
  saving: boolean;
  error: string | null;
  snapshot: TelegramSnapshot | null;
  view: View;
  selectedChatId: string | null;
  messages: TelegramMessage[];
  messagesLoading: boolean;
  profileOpen: boolean;
  load: () => Promise<void>;
  enterPreview: (displayName: string) => Promise<void>;
  selectChat: (id: string | null) => Promise<void>;
  send: (body: string) => Promise<void>;
  setView: (view: View) => void;
  setProfileOpen: (open: boolean) => void;
  saveProfile: (input: { firstName: string; lastName: string; about: string }) => Promise<void>;
  unlink: () => Promise<void>;
};

function isAuthError(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
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
  messagesLoading: false,
  profileOpen: false,

  setView: (view) => set({ view }),
  setProfileOpen: (profileOpen) => set({ profileOpen }),

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
    set({ selectedChatId: id, view: id ? "chat" : "list", messages: [] });
    if (!id) return;
    set({ messagesLoading: true });
    try {
      const messages = await telegramMessagesFn({ data: { chatId: id } });
      set({ messages, messagesLoading: false });
    } catch (err) {
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
    set({ sending: true, error: null });
    try {
      const message = await telegramSendFn({ data: { chatId, body } });
      const chats = (get().snapshot?.chats ?? []).map((chat) =>
        chat.id === chatId
          ? { ...chat, lastPreview: message.body.slice(0, 140), lastAt: message.createdAt }
          : chat,
      );
      const snapshot = get().snapshot;
      set({
        sending: false,
        messages: [...get().messages, message],
        snapshot: snapshot ? { ...snapshot, chats } : snapshot,
      });
    } catch (err) {
      set({
        sending: false,
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
        },
        view: "list",
        selectedChatId: null,
        messages: [],
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Could not disconnect.",
      });
    }
  },
}));

export function accountOf(state: TelegramState): TelegramAccount | null {
  return state.snapshot?.account ?? null;
}

export function chatsOf(state: TelegramState): TelegramChat[] {
  return state.snapshot?.chats ?? [];
}
