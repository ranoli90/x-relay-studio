import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { PushScreen } from "@/components/screen-stack";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useTelegram } from "@/lib/telegram/store";
import { ChatList, useChatQuery } from "./chat-list";
import { Conversation } from "./conversation";
import { PeerProfile } from "./peer-profile";
import { ProfileEdit } from "./profile-edit";
import { ProfilePane } from "./profile";
import { SettingsPane, UnlinkDialog } from "./settings";

export function ReplicaShell() {
  const loading = useTelegram((s) => s.loading);
  const snapshot = useTelegram((s) => s.snapshot);
  const view = useTelegram((s) => s.view);
  const selectedChatId = useTelegram((s) => s.selectedChatId);
  const messages = useTelegram((s) => s.messages);
  const messagesLoading = useTelegram((s) => s.messagesLoading);
  const sending = useTelegram((s) => s.sending);
  const saving = useTelegram((s) => s.saving);
  const error = useTelegram((s) => s.error);
  const folder = useTelegram((s) => s.folder);
  const notify = useTelegram((s) => s.notify);
  const load = useTelegram((s) => s.load);
  const sync = useTelegram((s) => s.sync);
  const selectChat = useTelegram((s) => s.selectChat);
  const send = useTelegram((s) => s.send);
  const setView = useTelegram((s) => s.setView);
  const setFolder = useTelegram((s) => s.setFolder);
  const setNotify = useTelegram((s) => s.setNotify);
  const saveProfile = useTelegram((s) => s.saveProfile);
  const setWatching = useTelegram((s) => s.setWatching);
  const unlink = useTelegram((s) => s.unlink);
  const { query, setQuery } = useChatQuery();
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [narrow, setNarrow] = useState(false);

  const account = snapshot?.account ?? null;
  const credential = snapshot?.credential ?? null;
  const watch = snapshot?.watch ?? null;
  const chats = snapshot?.chats ?? [];
  const selected = chats.find((c) => c.id === selectedChatId) ?? null;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;
    const delay = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return 120_000;
      if (watch?.lastError) return 90_000;
      return 45_000;
    };
    const tick = async () => {
      if (stopped) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        await sync();
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), delay());
    };
    timer = window.setTimeout(() => void tick(), 5_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [sync, watch?.lastError]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 839px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!narrow && account && !selectedChatId && chats[0]) {
      void selectChat(chats[0].id);
    }
  }, [narrow, account, selectedChatId, chats, selectChat]);

  function requestUnlink() {
    setConfirmUnlink(true);
  }

  const list = (
    <ChatList
      chats={chats}
      selectedId={selectedChatId}
      onSelect={(id) => void selectChat(id)}
      query={query}
      onQuery={setQuery}
      folder={folder}
      onFolder={setFolder}
      account={account}
      onSelf={() => setView("profile")}
    />
  );

  const settings = account ? (
    <SettingsPane
      account={account}
      watch={watch}
      notify={notify}
      onNotify={setNotify}
      onWatching={(on) => void setWatching(on)}
      onBack={() => setView("profile")}
      onUnlink={requestUnlink}
    />
  ) : null;

  const conversation = (
    <Conversation
      chat={selected}
      messages={messages}
      loading={messagesLoading}
      sending={sending}
      showBack={narrow}
      onBack={() => {
        void selectChat(null);
      }}
      onProfile={() => setView("peer")}
      onSend={(body) => void send(body)}
    />
  );

  if (!loading && snapshot && !snapshot.account) {
    return <Navigate to="/telegram" />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 pt-[env(safe-area-inset-top)]">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40"
        >
          <Logo className="size-6 shrink-0" />
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-medium">X Relay</span>
          </span>
        </Link>
        {account && !account.preview ? (
          <span className="min-w-0 truncate font-mono text-[11px] text-subtle">
            <span className={watch?.watching ? "text-up" : ""}>
              {watch?.watching ? "Watching" : "Paused"}
            </span>
            <span className="text-subtle">
              {" "}
              · {watch?.chatsWatched ?? chats.filter((c) => c.kind === "user").length} chats
            </span>
          </span>
        ) : account?.preview ? (
          <span className="font-mono text-[11px] uppercase tracking-widest text-subtle">Preview</span>
        ) : null}
        {authEnabled ? (
          <button
            type="button"
            className="ml-auto shrink-0 text-xs text-subtle hover:text-fg"
            onClick={() => void signOut("/")}
          >
            Sign out
          </button>
        ) : (
          <Link to="/" className="ml-auto shrink-0 text-xs text-subtle hover:text-fg">
            Home
          </Link>
        )}
      </header>

      {watch?.lastError ? (
        <div className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-down">
          {watch.lastError}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-bg">
        {loading && !account ? (
          <div className="grid h-full place-items-center bg-bg px-4">
            <div className="w-full max-w-md">
              <p className="font-mono text-xs uppercase tracking-widest text-subtle">X Relay</p>
              <div className="skeleton-shimmer mt-4 h-8 w-56 rounded-md" />
              <div className="skeleton-shimmer mt-4 h-20 w-full rounded-md" />
            </div>
          </div>
        ) : !account ? (
          <div className="grid h-full place-items-center bg-bg px-4 text-sm text-muted">
            Connect Telegram first.
          </div>
        ) : (
          <div className="tg-replica h-full min-h-0">
            {narrow ? (
              <div className="relative h-full min-h-0 overflow-hidden">
                {list}
                <PushScreen open={view === "chat" || view === "peer"} className="bg-[var(--tg-bg)]">
                  {conversation}
                </PushScreen>
                <PushScreen
                  open={view === "profile" || view === "edit" || view === "settings"}
                  className="bg-[var(--tg-bg-secondary)]"
                >
                  <ProfilePane
                    account={account}
                    showBack
                    onBack={() => setView(selectedChatId ? "chat" : "list")}
                    onEdit={() => setView("edit")}
                    onSettings={() => setView("settings")}
                    onUnlink={requestUnlink}
                  />
                </PushScreen>
                <PushScreen open={view === "peer"} className="bg-[var(--tg-bg-secondary)]" z={20}>
                  {selected ? (
                    <PeerProfile
                      chat={selected}
                      credential={credential}
                      showBack
                      onBack={() => setView("chat")}
                    />
                  ) : null}
                </PushScreen>
                <PushScreen open={view === "edit"} className="bg-[var(--tg-bg-secondary)]" z={20}>
                  <ProfileEdit
                    account={account}
                    saving={saving}
                    onBack={() => setView("profile")}
                    onSave={(d) => void saveProfile(d)}
                  />
                </PushScreen>
                <PushScreen open={view === "settings"} className="bg-[var(--tg-bg-secondary)]" z={20}>
                  {settings}
                </PushScreen>
              </div>
            ) : (
              <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)_minmax(0,320px)]">
                {list}
                {view === "edit" ? (
                  <ProfileEdit
                    account={account}
                    saving={saving}
                    onBack={() => setView("profile")}
                    onSave={(d) => void saveProfile(d)}
                  />
                ) : view === "settings" ? (
                  settings
                ) : view === "profile" ? (
                  <ProfilePane
                    account={account}
                    showBack={false}
                    onBack={() => undefined}
                    onEdit={() => setView("edit")}
                    onSettings={() => setView("settings")}
                    onUnlink={requestUnlink}
                  />
                ) : (
                  conversation
                )}
                {view === "edit" || view === "settings" || view === "profile" ? (
                  <div className="hidden place-items-center bg-[var(--tg-bg-secondary)] px-6 text-center text-sm text-[var(--tg-text-secondary)] xl:grid">
                    <div>
                      <p className="text-[var(--tg-text)]">{account.displayName}</p>
                      <p className="mt-2 text-xs">Saved in this studio. Telegram itself is unchanged.</p>
                    </div>
                  </div>
                ) : selected ? (
                  <div className="hidden min-h-0 xl:block">
                    <PeerProfile
                      chat={selected}
                      credential={credential}
                      showBack={false}
                      onBack={() => undefined}
                    />
                  </div>
                ) : (
                  <div className="hidden place-items-center bg-[var(--tg-bg-secondary)] px-6 text-center text-sm text-[var(--tg-text-secondary)] xl:grid">
                    <div>
                      <p className="text-[var(--tg-text)]">{account.displayName}</p>
                      <p className="mt-2 text-xs">Open a chat, or your profile from the list.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {error ? (
          <p className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-down">
            {error}
          </p>
        ) : null}
        <UnlinkDialog
          open={confirmUnlink}
          busy={loading}
          onCancel={() => setConfirmUnlink(false)}
          onConfirm={() => {
            void unlink().finally(() => setConfirmUnlink(false));
          }}
        />
      </div>
    </div>
  );
}
