import { create } from "zustand";
import {
  telegramEnterPreviewFn,
  telegramMeFn,
  telegramMessagesFn,
  telegramSendFn,
  telegramSetWatchingFn,
  telegramSetAutomationFn,
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
export type ShellTab = "inbox" | "business" | "media" | "settings";

export type TelegramUiErrorSource = "local" | "provider";

type TelegramState = {
  loading: boolean;
  sending: boolean;
  sendingChatId: string | null;
  saving: boolean;
  error: string | null;
  errorSource: TelegramUiErrorSource | null;
  snapshot: TelegramSnapshot | null;
  view: View;
  shellTab: ShellTab;
  selectedChatId: string | null;
  messages: TelegramMessage[];
  messageCache: Record<string, TelegramMessage[]>;
  drafts: Record<string, string>;
  messagesLoading: boolean;
  profileOpen: boolean;
  folder: TelegramFolder;
  notify: boolean;
  generation: number;
  load: () => Promise<void>;
  sync: () => Promise<void>;
  enterPreview: (displayName: string) => Promise<void>;
  selectChat: (id: string | null) => Promise<void>;
  send: (body: string) => Promise<boolean>;
  setDraft: (chatId: string, value: string) => void;
  setView: (view: View) => void;
  setShellTab: (tab: ShellTab) => void;
  ackVisibleChat: (chatId: string) => Promise<void>;
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
  dropSession: () => void;
  setWatching: (watching: boolean) => Promise<void>;
  setAutomationArmed: (armed: boolean) => Promise<void>;
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

function providerMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() ? err.message : fallback;
}

/** F19: a late load/sync/messages response must not apply after unlink or a chat switch. */
export function shouldApplyTelegram(
  started: { generation: number; chatId?: string | null },
  current: { generation: number; selectedChatId: string | null },
  opts?: { requireSameChat?: boolean },
): boolean {
  if (current.generation !== started.generation) return false;
  if (opts?.requireSameChat && current.selectedChatId !== started.chatId) return false;
  return true;
}

function emptyLinkedSnapshot(configured: boolean, generation: number): TelegramSnapshot {
  return {
    configured,
    mtprotoEnabled: false,
    onboarded: false,
    account: null,
    chats: [],
    credential: null,
    watch: null,
    generation,
  };
}

let draftTimers: Record<string, number> = {};

export const useTelegram = create<TelegramState>((set, get) => {
  function epoch() {
    return { generation: get().generation, selectedChatId: get().selectedChatId };
  }

  function dropCaches(nextGeneration: number) {
    return {
      generation: nextGeneration,
      selectedChatId: null as string | null,
      messages: [] as TelegramMessage[],
      messageCache: {} as Record<string, TelegramMessage[]>,
      drafts: {} as Record<string, string>,
      view: "list" as const,
      shellTab: "inbox" as const,
      sending: false,
      sendingChatId: null as string | null,
      messagesLoading: false,
      error: null as string | null,
      errorSource: null as TelegramUiErrorSource | null,
    };
  }

  return {
    loading: true,
    sending: false,
    sendingChatId: null,
    saving: false,
    error: null,
    errorSource: null,
    snapshot: null,
    view: "list",
    shellTab: "inbox",
    selectedChatId: null,
    messages: [],
    messageCache: {},
    drafts: {},
    messagesLoading: false,
    profileOpen: false,
    folder: "all",
    notify: readNotify(),
    generation: 0,

    setView: (view) => set({ view, error: null, errorSource: null }),
    setShellTab: (shellTab) =>
      set({
        shellTab,
        view: shellTab === "settings" ? "settings" : shellTab === "inbox" ? get().view : "list",
        error: null,
        errorSource: null,
      }),
    ackVisibleChat: async (chatId) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const { ackVisibleFn } = await import("@/lib/operator/fns");
        const result = await ackVisibleFn({
          data: {
            conversationId: chatId,
            conversationVisible: true,
            documentVisible: true,
            chatListOnly: false,
          },
        });
        if (result.unread !== 0) return;
        const snapshot = get().snapshot;
        if (!snapshot) return;
        set({
          snapshot: {
            ...snapshot,
            chats: snapshot.chats.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)),
          },
        });
      } catch {
        /* ack is best-effort; unread stays until a visible conversation ack succeeds */
      }
    },
    setProfileOpen: (profileOpen) => set({ profileOpen }),
    setFolder: (folder) => set({ folder }),
    clearError: () => set({ error: null, errorSource: null }),
    setDraft: (chatId, value) => {
      const drafts = { ...get().drafts };
      if (value) drafts[chatId] = value;
      else delete drafts[chatId];
      set({ drafts });
      if (typeof window === "undefined") return;
      if (draftTimers[chatId]) window.clearTimeout(draftTimers[chatId]);
      draftTimers[chatId] = window.setTimeout(() => {
        delete draftTimers[chatId];
        void import("@/lib/operator/fns")
          .then((m) => m.saveDraftFn({ data: { conversationId: chatId, body: value } }))
          .catch(() => undefined);
      }, 400);
    },
    setNotify: (on) => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("xrelay-tg-notify", on ? "1" : "0");
        if (on && "Notification" in window && Notification.permission === "default") {
          void Notification.requestPermission();
        }
      }
      set({ notify: on });
    },

    dropSession: () => {
      set({
        ...dropCaches(get().generation + 1),
        loading: false,
        saving: false,
        snapshot: null,
      });
    },

    load: async () => {
      const started = { generation: get().generation, chatId: get().selectedChatId };
      const keep = Boolean(get().snapshot?.account);
      if (!keep) set({ loading: true, error: null, errorSource: null });
      else set({ error: null, errorSource: null });
      try {
        const snapshot = await telegramMeFn();
        if (!shouldApplyTelegram(started, epoch())) return;
        const prevServer = get().snapshot?.generation;
        const hadAccount = Boolean(get().snapshot?.account);
        const serverGen = snapshot.generation ?? 1;
        const accountChanged = Boolean(prevServer) && prevServer !== serverGen;
        if (!snapshot.account || accountChanged) {
          const nextGen = hadAccount || accountChanged ? get().generation + 1 : get().generation;
          set({
            snapshot,
            loading: false,
            ...dropCaches(nextGen),
          });
          return;
        }
        set({ snapshot, loading: false });
        void import("@/lib/operator/fns")
          .then((m) => m.loadOperatorDeskFn())
          .then((desk) => {
            if (!shouldApplyTelegram(started, epoch())) return;
            if (desk.drafts) set({ drafts: { ...get().drafts, ...desk.drafts } });
          })
          .catch(() => undefined);
      } catch (err) {
        if (!shouldApplyTelegram(started, epoch())) return;
        if (isAuthError(err)) {
          set({
            ...dropCaches(get().generation + 1),
            loading: false,
            snapshot: null,
          });
          return;
        }
        set({
          loading: false,
          error: providerMessage(err, "Could not load Telegram."),
          errorSource: "provider",
        });
      }
    },

    sync: async () => {
      const started = { generation: get().generation, chatId: get().selectedChatId };
      const { snapshot, notify } = get();
      if (!snapshot?.account || syncInFlight) return;
      syncInFlight = true;
      try {
        const next = await telegramSyncFn({ data: { chatId: started.chatId } });
        if (!shouldApplyTelegram(started, epoch())) return;
        const live = get().snapshot;
        if (!live?.account) return;
        const prevUnread = (live.chats ?? []).reduce((n, c) => n + (c.unread ?? 0), 0);
        const nextUnread = next.chats.reduce((n, c) => n + (c.unread ?? 0), 0);
        const sameChat = shouldApplyTelegram(started, epoch(), { requireSameChat: true });
        const chatId = started.chatId;
        set({
          snapshot: {
            ...live,
            chats: next.chats,
            watch: live.watch,
          },
          messages: sameChat && chatId ? next.messages : get().messages,
          messageCache:
            chatId
              ? { ...get().messageCache, [chatId]: next.messages }
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
      const gen = get().generation + 1;
      set({
        ...dropCaches(gen),
        loading: true,
        snapshot: get().snapshot,
      });
      const started = { generation: gen, chatId: null as string | null };
      try {
        const snapshot = await telegramEnterPreviewFn({ data: { displayName } });
        if (!shouldApplyTelegram(started, epoch())) return;
        set({ snapshot, loading: false, view: "list" });
      } catch (err) {
        if (!shouldApplyTelegram(started, epoch())) return;
        set({
          loading: false,
          error: providerMessage(err, "Could not open preview."),
          errorSource: "provider",
        });
        throw err;
      }
    },

    selectChat: async (id) => {
      if (!id) {
        set({ selectedChatId: null, view: "list", messagesLoading: false });
        return;
      }
      const started = { generation: get().generation, chatId: id };
      const cached = get().messageCache[id];
      set({
        selectedChatId: id,
        view: "chat",
        shellTab: "inbox",
        messages: cached ?? [],
        messagesLoading: !cached,
        error: null,
        errorSource: null,
      });
      try {
        const messages = await telegramMessagesFn({ data: { chatId: id } });
        if (!shouldApplyTelegram(started, epoch())) return;
        const cache = { ...get().messageCache, [id]: messages };
        if (!shouldApplyTelegram(started, epoch(), { requireSameChat: true })) {
          set({ messageCache: cache });
          return;
        }
        const snapshot = get().snapshot;
        set({
          messages,
          messageCache: cache,
          messagesLoading: false,
          snapshot,
        });
      } catch (err) {
        if (!shouldApplyTelegram(started, epoch(), { requireSameChat: true })) return;
        set({
          messagesLoading: false,
          error: providerMessage(err, "Could not load messages."),
          errorSource: "provider",
        });
      }
    },

    saveProfile: async (input) => {
      const started = { generation: get().generation, chatId: get().selectedChatId };
      set({ saving: true, error: null, errorSource: null });
      try {
        const account = await telegramUpdateProfileFn({ data: input });
        if (!shouldApplyTelegram(started, epoch())) return;
        const snapshot = get().snapshot;
        set({
          saving: false,
          snapshot: snapshot ? { ...snapshot, account } : snapshot,
          view: "profile",
        });
      } catch (err) {
        if (!shouldApplyTelegram(started, epoch())) return;
        set({
          saving: false,
          error: providerMessage(err, "Could not save profile."),
          errorSource: "provider",
        });
      }
    },

    send: async (body) => {
      const chatId = get().selectedChatId;
      const text = body.trim();
      if (!chatId) {
        set({ error: "Select a chat first.", errorSource: "local" });
        return false;
      }
      if (!text) {
        set({ error: "Message is empty.", errorSource: "local" });
        return false;
      }
      const started = { generation: get().generation, chatId };
      const account = get().snapshot?.account;
      const temp: TelegramMessage = {
        id: `tmp_${Date.now()}`,
        chatId,
        fromSelf: true,
        authorName: account?.displayName ?? "You",
        body: text,
        createdAt: new Date().toISOString(),
        status: "sending",
      };
      const cached = get().messageCache[chatId] ?? get().messages;
      const drafts = { ...get().drafts };
      delete drafts[chatId];
      set({
        sending: true,
        sendingChatId: chatId,
        error: null,
        errorSource: null,
        drafts,
        messages: get().selectedChatId === chatId ? [...cached, temp] : get().messages,
        messageCache: { ...get().messageCache, [chatId]: [...cached, temp] },
      });
      try {
        const message = await telegramSendFn({ data: { chatId, body: text } });
        if (!shouldApplyTelegram(started, epoch())) return false;
        const chats = (get().snapshot?.chats ?? []).map((chat) =>
          chat.id === chatId
            ? { ...chat, lastPreview: message.body.slice(0, 140), lastAt: message.createdAt }
            : chat,
        );
        const snapshot = get().snapshot;
        const thread = (get().messageCache[chatId] ?? []).filter((m) => m.id !== temp.id).concat(message);
        const nextDrafts = { ...get().drafts };
        delete nextDrafts[chatId];
        set({
          sending: get().selectedChatId === chatId ? false : get().sending,
          sendingChatId: get().sendingChatId === chatId ? null : get().sendingChatId,
          drafts: nextDrafts,
          messages: get().selectedChatId === chatId ? thread : get().messages,
          messageCache: { ...get().messageCache, [chatId]: thread },
          snapshot: snapshot ? { ...snapshot, chats } : snapshot,
        });
        return true;
      } catch (err) {
        if (!shouldApplyTelegram(started, epoch())) return false;
        const thread = (get().messageCache[chatId] ?? []).filter((m) => m.id !== temp.id);
        const restored = { ...get().drafts, [chatId]: text };
        set({
          sending: get().selectedChatId === chatId ? false : get().sending,
          sendingChatId: get().sendingChatId === chatId ? null : get().sendingChatId,
          drafts: restored,
          messages: get().selectedChatId === chatId ? thread : get().messages,
          messageCache: { ...get().messageCache, [chatId]: thread },
          error: providerMessage(err, "Telegram did not accept that message."),
          errorSource: "provider",
        });
        return false;
      }
    },

    unlink: async () => {
      const gen = get().generation + 1;
      const configured = get().snapshot?.configured ?? false;
      set({
        ...dropCaches(gen),
        loading: true,
        snapshot: get().snapshot,
      });
      const started = { generation: gen, chatId: null as string | null };
      try {
        await telegramUnlinkFn();
        if (!shouldApplyTelegram(started, epoch())) return;
        set({
          loading: false,
          snapshot: emptyLinkedSnapshot(configured, (get().snapshot?.generation ?? 0) + 1),
        });
      } catch (err) {
        if (!shouldApplyTelegram(started, epoch())) return;
        set({
          loading: false,
          error: providerMessage(err, "Could not disconnect."),
          errorSource: "provider",
        });
        throw err;
      }
    },

    setWatching: async (watching) => {
      const started = { generation: get().generation, chatId: get().selectedChatId };
      set({ error: null, errorSource: null });
      try {
        const snapshot = await telegramSetWatchingFn({ data: { watching } });
        if (!shouldApplyTelegram(started, epoch())) return;
        set({ snapshot });
      } catch (err) {
        if (!shouldApplyTelegram(started, epoch())) return;
        set({
          error: providerMessage(err, "Could not change watching."),
          errorSource: "provider",
        });
      }
    },

    setAutomationArmed: async (armed) => {
      const started = { generation: get().generation, chatId: get().selectedChatId };
      set({ error: null, errorSource: null });
      try {
        const snapshot = await telegramSetAutomationFn({ data: { armed } });
        if (!shouldApplyTelegram(started, epoch())) return;
        set({ snapshot });
      } catch (err) {
        if (!shouldApplyTelegram(started, epoch())) return;
        set({
          error: providerMessage(err, "Could not change AI processing."),
          errorSource: "provider",
        });
      }
    },
  };
});

export function accountOf(state: TelegramState): TelegramAccount | null {
  return state.snapshot?.account ?? null;
}

export function chatsOf(state: TelegramState): TelegramChat[] {
  return state.snapshot?.chats ?? [];
}
