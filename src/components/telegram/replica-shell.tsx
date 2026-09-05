import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { UserButton } from "@/lib/auth/gates";
import { useTelegram } from "@/lib/telegram/store";
import { ChatList, useChatQuery } from "./chat-list";
import { Conversation } from "./conversation";
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
  const profileOpen = useTelegram((s) => s.profileOpen);
  const load = useTelegram((s) => s.load);
  const selectChat = useTelegram((s) => s.selectChat);
  const send = useTelegram((s) => s.send);
  const setView = useTelegram((s) => s.setView);
  const setProfileOpen = useTelegram((s) => s.setProfileOpen);
  const saveProfile = useTelegram((s) => s.saveProfile);
  const unlink = useTelegram((s) => s.unlink);
  const { query, setQuery } = useChatQuery();
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 839px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const account = snapshot?.account ?? null;
  const chats = snapshot?.chats ?? [];
  const selected = chats.find((c) => c.id === selectedChatId) ?? null;

  useEffect(() => {
    if (!narrow && account && !selectedChatId && chats[0]) {
      void selectChat(chats[0].id);
    }
  }, [narrow, account, selectedChatId, chats, selectChat]);

  function requestUnlink() {
    setConfirmUnlink(true);
  }

  const mobileMain =
    view === "edit" && account ? (
      <ProfileEdit account={account} saving={saving} onBack={() => setView("profile")} onSave={(d) => void saveProfile(d)} />
    ) : view === "settings" && account ? (
      <SettingsPane account={account} onBack={() => setView("profile")} onUnlink={requestUnlink} />
    ) : view === "profile" && account ? (
      <ProfilePane
        account={account}
        showBack
        onBack={() => setView(selectedChatId ? "chat" : "list")}
        onEdit={() => setView("edit")}
        onSettings={() => setView("settings")}
        onUnlink={requestUnlink}
      />
    ) : view === "chat" ? (
      <Conversation
        chat={selected}
        messages={messages}
        loading={messagesLoading}
        sending={sending}
        showBack
        onBack={() => {
          void selectChat(null);
        }}
        onProfile={() => setView("profile")}
        onSend={(body) => void send(body)}
      />
    ) : (
      <ChatList
        chats={chats}
        selectedId={selectedChatId}
        onSelect={(id) => void selectChat(id)}
        query={query}
        onQuery={setQuery}
      />
    );

  if (!loading && snapshot && !snapshot.account) {
    return <Navigate to="/telegram" />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40"
        >
          <Logo className="size-7" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">X Relay</span>
            <span className="block truncate font-mono text-xs text-subtle">Telegram</span>
          </span>
        </Link>
        {account?.preview ? (
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-subtle">
            Preview
          </span>
        ) : null}
        <Link
          to="/"
          className="ml-auto hidden text-xs text-subtle transition-colors hover:text-fg sm:inline"
        >
          Back to platforms
        </Link>
        <div className="ml-auto sm:ml-0">
          <UserButton />
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {loading && !account ? (
          <div className="grid h-full place-items-center text-sm text-muted">Loading…</div>
        ) : !account ? (
          <div className="grid h-full place-items-center px-4 text-sm text-muted">
            Connect Telegram first.
          </div>
        ) : (
          <div className="tg-replica h-full min-h-0 font-[ui-sans-serif,system-ui,sans-serif]">
            {narrow ? (
              mobileMain
            ) : (
              <div className="grid h-full min-h-0 grid-cols-[minmax(0,420px)_minmax(0,1fr)_minmax(0,360px)]">
                <ChatList
                  chats={chats}
                  selectedId={selectedChatId}
                  onSelect={(id) => void selectChat(id)}
                  query={query}
                  onQuery={setQuery}
                />
                {view === "edit" ? (
                  <ProfileEdit
                    account={account}
                    saving={saving}
                    onBack={() => setView("profile")}
                    onSave={(d) => void saveProfile(d)}
                  />
                ) : view === "settings" ? (
                  <SettingsPane account={account} onBack={() => setView("profile")} onUnlink={requestUnlink} />
                ) : (
                  <Conversation
                    chat={selected}
                    messages={messages}
                    loading={messagesLoading}
                    sending={sending}
                    showBack={false}
                    onBack={() => undefined}
                    onProfile={() => setProfileOpen(true)}
                    onSend={(body) => void send(body)}
                  />
                )}
                {view === "edit" || view === "settings" ? (
                  <ProfilePane
                    account={account}
                    showBack={false}
                    onBack={() => undefined}
                    onEdit={() => setView("edit")}
                    onSettings={() => setView("settings")}
                    onUnlink={requestUnlink}
                  />
                ) : profileOpen ? (
                  <ProfilePane
                    account={account}
                    showBack={false}
                    onBack={() => setProfileOpen(false)}
                    onEdit={() => setView("edit")}
                    onSettings={() => setView("settings")}
                    onUnlink={requestUnlink}
                  />
                ) : (
                  <div className="grid place-items-center bg-[var(--tg-bg-secondary)] px-6 text-center text-sm text-[var(--tg-text-secondary)]">
                    <div>
                      <p className="text-[var(--tg-text)]">{account.displayName}</p>
                      <p className="mt-2 text-xs">Open profile from the conversation header.</p>
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
            setConfirmUnlink(false);
            void unlink();
          }}
        />
      </div>
    </div>
  );
}
