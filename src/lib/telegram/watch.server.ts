import { getSql } from "@/lib/db";
import {
  emptyCheckResults,
  mergeCheckResults,
  requiredChecksPassed,
  type TelegramCheckId,
  type TelegramCheckResult,
} from "./checks";
import { TelegramError } from "./errors";
import {
  decryptSessionMaterial,
  finishUserOnboarding,
  getUserSession,
  markOpenRouterReady,
  recordSync,
  saveChecks,
  saveSignedIn,
} from "./session.server";
import { fetchMe, pullInbox } from "./mtproto.server";
import { redactPreview } from "./preview";
import { appendMessage, getAccount, upsertLinkedAccount, upsertUserChat } from "./snapshot.server";

function scopedChatId(userId: string, dialogChatId: string): string {
  const uid = userId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 36);
  return `u_${uid}_${dialogChatId}`.slice(0, 160);
}

export async function syncWatch(userId: string, opts?: { chatId?: string | null; historyLimit?: number }) {
  const row = await getUserSession(userId);
  if (!row?.session_enc) {
    const chats = await (await import("./snapshot.server")).listChats(userId);
    return { chats, messages: [] as Awaited<ReturnType<typeof import("./snapshot.server").listMessages>> };
  }
  if (!row.watching) {
    const { listChats, listMessages } = await import("./snapshot.server");
    const chats = await listChats(userId);
    const messages = opts?.chatId ? await listMessages(userId, opts.chatId) : [];
    return { chats, messages };
  }

  const material = await decryptSessionMaterial(row);
  let ingested = 0;
  try {
    const account = await getAccount(userId);
    const selfId = account?.telegramUserId ?? 0;
    const { dialogs, histories, session } = await pullInbox({
      apiId: material.apiId,
      apiHash: material.apiHash,
      session: material.session,
      selfId,
      dialogLimit: 40,
      historyLimit: opts?.historyLimit ?? 40,
      historyChats: 0,
      skipPhotoPeers: [],
      photoLimit: 0,
      focusChatId: opts?.chatId ?? null,
    });
    if (session !== material.session) await saveSignedIn({ userId, session });

    for (const dialog of dialogs) {
      const chatId = scopedChatId(userId, dialog.chatId);
      await upsertUserChat({
        id: chatId,
        userId,
        title: dialog.title,
        peerId: dialog.peerId,
        unread: dialog.unread,
        pinned: dialog.pinned,
        muted: dialog.muted,
        lastPreview: redactPreview(dialog.lastPreview),
        lastAt: dialog.lastAt,
        photoUrl: null,
      });
    }

    const byChat = new Map(histories.map((h) => [h.chatId, h.messages]));
    for (const [dialogChatId, pulled] of byChat) {
      const chatId = scopedChatId(userId, dialogChatId);
      for (const msg of pulled) {
        const saved = await appendMessage({
          userId,
          chatId,
          fromSelf: msg.fromSelf,
          authorName: msg.authorName,
          body: msg.body,
          telegramMessageId: msg.telegramMessageId,
          createdAt: msg.createdAt,
          bumpUnread: false,
          aiStatus: msg.fromSelf ? "outbound" : "queued",
        });
        if (saved) ingested += 1;
      }
    }

    await recordSync({
      userId,
      chatsWatched: dialogs.length,
      messagesIngested: (row.messages_ingested || 0) + ingested,
    });
  } catch (err) {
    const message = err instanceof TelegramError ? err.message : "Could not refresh Telegram.";
    const hadChats = (row.chats_watched || 0) > 0;
    await recordSync({
      userId,
      chatsWatched: row.chats_watched || 0,
      messagesIngested: row.messages_ingested || 0,
      error: hadChats ? null : message,
    });
  }

  const { listChats, listMessages } = await import("./snapshot.server");
  const chats = await listChats(userId);
  const messages = opts?.chatId ? await listMessages(userId, opts.chatId) : [];
  return { chats, messages };
}

export async function runWatchChecks(userId: string): Promise<TelegramCheckResult[]> {
  const row = await getUserSession(userId);
  if (!row) throw new TelegramError("invalid", "Connect Telegram first.", 404);
  const now = new Date().toISOString();
  const results = emptyCheckResults();
  const set = (id: TelegramCheckId, ok: boolean, detail: string) => {
    const item = results.find((r) => r.id === id);
    if (item) {
      item.ok = ok;
      item.detail = detail;
      item.ranAt = now;
    }
  };

  const account = await getAccount(userId);
  if (row.session_enc && account && !account.preview) {
    set("signed_in", true, account.username ? `@${account.username}` : account.firstName);
  } else {
    try {
      const material = await decryptSessionMaterial(row);
      const { me, session } = await fetchMe(material);
      if (session !== material.session) await saveSignedIn({ userId, session });
      await upsertLinkedAccount({
        userId,
        telegramUserId: me.telegramUserId,
        firstName: me.firstName,
        lastName: me.lastName,
        username: me.username,
        photoUrl: null,
        botCanWrite: false,
        path: "mtproto",
        preview: false,
      });
      set("signed_in", true, me.username ? `@${me.username}` : me.firstName);
    } catch (err) {
      set("signed_in", false, err instanceof Error ? err.message : "Could not reach Telegram.");
      await saveChecks(userId, mergeCheckResults(results));
      return mergeCheckResults(results);
    }
  }

  await saveChecks(userId, mergeCheckResults(results));

  try {
    const { chats } = await syncWatch(userId, { historyLimit: 8 });
    const real = chats.filter((c) => c.kind === "user");
    const withPreview = real.filter((c) => c.lastPreview);
    set(
      "chats_visible",
      real.length > 0,
      real.length ? `${real.length} chats on this desk` : "No chats came through yet.",
    );
    const sql = await getSql();
    const msgCount = await sql.query<{ n: number }>(
      `select count(*)::int as n from telegram_messages where user_id = $1`,
      [userId],
    );
    const n = msgCount[0]?.n ?? 0;
    const readable = n > 0 || withPreview.length > 0;
    set(
      "messages_readable",
      readable,
      n
        ? `${n} messages stored`
        : withPreview.length
          ? `Previews from ${withPreview.length} chats`
          : "We listed chats but didn’t get message text yet.",
    );
    const latest = await getUserSession(userId);
    set(
      "watching_on",
      Boolean(latest?.watching) && (Boolean(latest?.last_sync_at) || real.length > 0),
      real.length
        ? "Watching is on. New messages will land here."
        : latest?.last_error || "Watching is on. New messages will land here.",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not watch Telegram.";
    set("chats_visible", false, message);
    set("messages_readable", false, message);
    set("watching_on", false, message);
  }

  const latest = await getUserSession(userId);
  try {
    const { pingOpenRouter } = await import("@/lib/openrouter.server");
    const ok = await pingOpenRouter();
    if (ok) await markOpenRouterReady(userId);
    set(
      "openrouter_ready",
      ok,
      ok
        ? "OpenRouter is ready. Nothing is sent until you start automation."
        : "OpenRouter didn’t answer. Watching still works.",
    );
  } catch {
    set(
      "openrouter_ready",
      Boolean(latest?.openrouter_ok_at),
      latest?.openrouter_ok_at
        ? "OpenRouter is ready."
        : "OpenRouter didn’t answer. Watching still works.",
    );
  }

  const merged = mergeCheckResults(results);
  await saveChecks(userId, merged);
  return merged;
}

export async function finishWatchOnboarding(userId: string): Promise<void> {
  const row = await getUserSession(userId);
  if (!row?.session_enc) throw new TelegramError("invalid", "Connect Telegram first.", 400);
  const checks = mergeCheckResults(JSON.parse(row.checks_json || "[]") as TelegramCheckResult[]);
  if (!requiredChecksPassed(checks)) {
    throw new TelegramError("invalid", "Finish the required checks first.", 400);
  }
  await finishUserOnboarding(userId);
}
