import { getSql } from "@/lib/db";
import {
  emptyCheckResults,
  mergeCheckResults,
  requiredChecksPassed,
  stampCheck,
  type TelegramCheckId,
  type TelegramCheckResult,
} from "./checks";
import { TelegramError, isTerminalSessionError } from "./errors";
import { withMtprotoLease } from "./lease.server";
import {
  assertSessionLive,
  decryptSessionMaterial,
  finishUserOnboarding,
  getUserSession,
  markOpenRouterReady,
  persistMappedError,
  recordSync,
  saveChecks,
  saveSignedIn,
  stampActivationWatermark,
} from "./session.server";
import { fetchMe, pullInbox } from "./mtproto.server";
import { redactPreview } from "./preview";
import { appendMessage, getAccount, getChatPeer, upsertLinkedAccount, upsertUserChat } from "./snapshot.server";
import { classifyInboundAiStatus } from "./watch-status.ts";

function scopedChatId(userId: string, dialogChatId: string): string {
  const uid = userId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 36);
  return `u_${uid}_${dialogChatId}`.slice(0, 160);
}

const FRESH_MS = 45_000;

/** Live session is enough to pull history. Watching is not send authorization. */
export function sessionReadyForBackgroundWatch(
  row:
    | {
        watching?: boolean | null;
        session_enc?: string | null;
        has_session?: boolean | null;
        hasSession?: boolean | null;
        auth_dead?: boolean | null;
        emergency_stop?: boolean | null;
        background_run?: boolean | null;
      }
    | null
    | undefined,
): boolean {
  if (row?.emergency_stop) return false;
  const enc = row?.session_enc;
  const hasEnc = typeof enc === "string" ? enc.length > 0 : Boolean(enc);
  const hasSession = Boolean(row?.has_session ?? row?.hasSession ?? hasEnc);
  return Boolean(hasSession && !row?.auth_dead);
}

export async function syncWatch(userId: string, opts?: { chatId?: string | null; historyLimit?: number; forceOnce?: boolean }) {
  const row = await getUserSession(userId);
  if (!row?.session_enc) {
    const chats = await (await import("./snapshot.server")).listChats(userId);
    return { chats, messages: [] as Awaited<ReturnType<typeof import("./snapshot.server").listMessages>>, liveOk: false };
  }
  if (row.auth_dead) {
    const { listChats, listMessages } = await import("./snapshot.server");
    const chats = await listChats(userId);
    const messages = opts?.chatId ? await listMessages(userId, opts.chatId) : [];
    return { chats, messages, liveOk: false };
  }
  if (!row.watching && !opts?.forceOnce) {
    const { listChats, listMessages } = await import("./snapshot.server");
    const chats = await listChats(userId);
    const messages = opts?.chatId ? await listMessages(userId, opts.chatId) : [];
    return { chats, messages, liveOk: false };
  }
  try {
    assertSessionLive(row);
  } catch (err) {
    const { listChats, listMessages } = await import("./snapshot.server");
    const chats = await listChats(userId);
    const messages = opts?.chatId ? await listMessages(userId, opts.chatId) : [];
    if (err instanceof TelegramError && err.code === "flood") return { chats, messages, liveOk: false };
    throw err;
  }

  const lastSync = row.last_sync_at ? new Date(row.last_sync_at).getTime() : 0;
  const fresh = lastSync > 0 && Date.now() - lastSync < FRESH_MS;
  if (fresh && !opts?.forceOnce && !opts?.chatId) {
    const { listChats } = await import("./snapshot.server");
    const chats = await listChats(userId);
    return { chats, messages: [] as Awaited<ReturnType<typeof import("./snapshot.server").listMessages>>, liveOk: true };
  }
  const skipDialogs = Boolean(fresh && opts?.chatId);

  const material = await decryptSessionMaterial(row);
  const generation = Number(row.account_generation) || 1;
  let ingested = 0;
  let liveOk = true;
  try {
    await withMtprotoLease(userId, async () => {
      const account = await getAccount(userId);
      const selfId = account?.telegramUserId ?? 0;
      const focusPeer = opts?.chatId ? await getChatPeer(userId, opts.chatId) : null;
      const { dialogs, histories, session } = await pullInbox({
        apiId: material.apiId,
        apiHash: material.apiHash,
        session: material.session,
        selfId,
        dialogLimit: 40,
        historyLimit: opts?.historyLimit ?? 40,
        historyChats: skipDialogs ? 0 : 1,
        skipPhotoPeers: [],
        photoLimit: 0,
        focusChatId: opts?.chatId ?? null,
        skipDialogs,
        focusAccessHash: focusPeer?.accessHash ?? null,
        focusPeerKind: focusPeer?.peerKind ?? null,
      });
      if (session !== material.session) await saveSignedIn({ userId, session, generation });

      const openId = opts?.chatId ?? null;
      for (const dialog of dialogs) {
        const chatId = scopedChatId(userId, dialog.chatId);
        const open = Boolean(
          openId &&
            (openId === chatId || openId.endsWith(dialog.chatId) || openId.includes(dialog.peerId)),
        );
        await upsertUserChat({
          id: chatId,
          userId,
          title: dialog.title,
          peerId: dialog.peerId,
          unread: open ? 0 : dialog.unread,
          pinned: dialog.pinned,
          muted: dialog.muted,
          lastPreview: redactPreview(dialog.lastPreview),
          lastAt: dialog.lastAt,
          photoUrl: null,
          accessHash: dialog.accessHash,
          peerKind: dialog.peerKind,
        });
      }

      const byChat = new Map(histories.map((h) => [h.chatId, h.messages]));
      const watermark = row.activation_watermark ?? null;
      let newestInbound: string | null = null;
      for (const [dialogChatId, pulled] of byChat) {
        const chatId = scopedChatId(userId, dialogChatId);
        for (const msg of pulled) {
          const aiStatus = classifyInboundAiStatus({
            fromSelf: msg.fromSelf,
            createdAt: msg.createdAt,
            watermark,
          });
          if (!msg.fromSelf && msg.createdAt) {
            const iso = typeof msg.createdAt === "string" ? msg.createdAt : new Date(msg.createdAt).toISOString();
            if (!newestInbound || iso > newestInbound) newestInbound = iso;
          }
          const saved = await appendMessage({
            userId,
            chatId,
            fromSelf: msg.fromSelf,
            authorName: msg.authorName,
            body: msg.body,
            telegramMessageId: msg.telegramMessageId,
            createdAt: msg.createdAt,
            bumpUnread: false,
            aiStatus,
          });
          if (saved) ingested += 1;
        }
      }
      if (!watermark) {
        await stampActivationWatermark(userId, newestInbound ? new Date(newestInbound) : new Date());
      }

      await recordSync({
        userId,
        chatsWatched: dialogs.length || row.chats_watched || 0,
        messagesIngested: (row.messages_ingested || 0) + ingested,
        generation,
      });
    });
  } catch (err) {
    liveOk = false;
    await persistMappedError(userId, err);
    const message = err instanceof TelegramError ? err.message : "Could not refresh Telegram.";
    await recordSync({
      userId,
      chatsWatched: row.chats_watched || 0,
      messagesIngested: row.messages_ingested || 0,
      error: message,
      generation,
    });
  }

  const { listChats, listMessages } = await import("./snapshot.server");
  const chats = await listChats(userId);
  const messages = opts?.chatId ? await listMessages(userId, opts.chatId) : [];
  return { chats, messages, liveOk };
}

export async function runWatchChecks(userId: string): Promise<TelegramCheckResult[]> {
  const row = await getUserSession(userId);
  if (!row) throw new TelegramError("invalid", "Connect Telegram first.", 404);
  const now = new Date().toISOString();
  const previous = mergeCheckResults(parseStored(row.checks_json));
  const results = emptyCheckResults();
  const prev = (id: TelegramCheckId) => previous.find((r) => r.id === id);
  const set = (id: TelegramCheckId, ok: boolean, detail: string, terminal = false) => {
    const item = results.find((r) => r.id === id);
    if (!item) return;
    const stamped = stampCheck(prev(id), { ok, detail, at: now, terminal });
    item.ok = stamped.ok;
    item.detail = stamped.detail;
    item.ranAt = stamped.ranAt;
    item.lastAttemptAt = stamped.lastAttemptAt;
    item.lastSuccessAt = stamped.lastSuccessAt;
  };

  const account = await getAccount(userId);
  if (row.session_enc && account && !account.preview) {
    set("signed_in", true, account.username ? `@${account.username}` : account.firstName);
  } else {
    try {
      assertSessionLive(row);
      const material = await decryptSessionMaterial(row);
      const { me, session } = await withMtprotoLease(userId, () => fetchMe(material));
      if (session !== material.session) {
        await saveSignedIn({ userId, session, generation: Number(row.account_generation) || 1 });
      }
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
      await persistMappedError(userId, err);
      const terminal = err instanceof TelegramError && isTerminalSessionError(err.code);
      set("signed_in", false, err instanceof Error ? err.message : "Could not reach Telegram.", terminal);
      await saveChecks(userId, mergeCheckResults(results));
      return mergeCheckResults(results);
    }
  }

  await saveChecks(userId, mergeCheckResults(results));

  try {
    const { chats, liveOk } = await syncWatch(userId, { historyLimit: 8, forceOnce: true });
    const real = chats.filter((c) => c.kind === "user");
    const withPreview = real.filter((c) => c.lastPreview);
    const latestAfter = await getUserSession(userId);
    const terminal = Boolean(latestAfter?.auth_dead);
    set(
      "chats_visible",
      liveOk,
      liveOk
        ? real.length
          ? `${real.length} chats on this desk`
          : "No chats on this account yet."
        : latestAfter?.last_error || "Could not list chats just now.",
      terminal,
    );
    const sql = await getSql();
    const msgCount = await sql.query<{ n: number }>(
      `select count(*)::int as n from telegram_messages where user_id = $1`,
      [userId],
    );
    const n = msgCount[0]?.n ?? 0;
    set(
      "messages_readable",
      liveOk,
      liveOk
        ? n
          ? `${n} messages stored`
          : withPreview.length
            ? `Previews from ${withPreview.length} chats`
            : "No messages yet — that's fine on an empty account."
        : latestAfter?.last_error || "Could not read messages just now.",
      terminal,
    );
    const live = Boolean(latestAfter?.session_enc) && !latestAfter?.auth_dead;
    set(
      "watching_on",
      live,
      latestAfter?.watching
        ? "Watching is on. New messages will land here."
        : "Watching can be turned on from settings. This check does not turn it on.",
      terminal,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not watch Telegram.";
    const terminal = err instanceof TelegramError && isTerminalSessionError(err.code);
    set("chats_visible", false, message, terminal);
    set("messages_readable", false, message, terminal);
    set("watching_on", false, message, terminal);
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

function parseStored(raw: string | null | undefined): TelegramCheckResult[] {
  if (!raw) return emptyCheckResults();
  try {
    const parsed = JSON.parse(raw) as TelegramCheckResult[];
    return Array.isArray(parsed) ? parsed : emptyCheckResults();
  } catch {
    return emptyCheckResults();
  }
}

export async function finishWatchOnboarding(userId: string): Promise<void> {
  const row = await getUserSession(userId);
  if (!row?.session_enc) throw new TelegramError("invalid", "Connect Telegram first.", 400);
  assertSessionLive(row);
  const checks = mergeCheckResults(JSON.parse(row.checks_json || "[]") as TelegramCheckResult[]);
  if (!requiredChecksPassed(checks)) {
    throw new TelegramError("invalid", "Finish the required checks first.", 400);
  }
  await finishUserOnboarding(userId);
}
