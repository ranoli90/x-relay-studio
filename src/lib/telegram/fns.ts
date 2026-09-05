import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { helperChatId } from "./bot-token";
import type { TelegramCheckId } from "./checks";
import { TELEGRAM_CHECK_IDS } from "./checks";
import { TelegramError } from "./errors";
import type {
  TelegramChat,
  TelegramCredentialPublic,
  TelegramMessage,
  TelegramOnboardingStep,
  TelegramSnapshot,
  TelegramStatus,
} from "./types";
import {
  MessagesSchema,
  PreviewNameSchema,
  ProfileSchema,
  SaveKeySchema,
  SendSchema,
  StartLoginSchema,
  SubmitCodeSchema,
  SubmitPasswordSchema,
  SyncSchema,
  WatchToggleSchema,
  AutomationToggleSchema,
  parseOrThrow,
  parsedStartLogin,
} from "./validate";

const CHECK_ID_SET = new Set<string>(TELEGRAM_CHECK_IDS);

type SignedMe = {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
};

function signedMeOf(signed: object): SignedMe | null {
  if (!signed || typeof signed !== "object" || !("me" in signed)) return null;
  const me = (signed as { me?: SignedMe | null }).me;
  return me ?? null;
}

function kickAgentLoop(userId?: string): void {
  void import("@/lib/agent/loop.server")
    .then((m) => {
      if (userId) m.markDeskPresent(userId);
      m.ensureAgentLoop();
    })
    .catch(() => {
      /* in-process loop is best-effort */
    });
}

async function buildStatus(userId: string): Promise<TelegramStatus> {
  const { telegramConfigured, telegramMtprotoEnabled, telegramUserApp } = await import(
    "./config.server"
  );
  const { getAccount } = await import("./snapshot.server");
  const { getCredentialRow, toPublic, deriveStep } = await import("./credentials.server");
  const { getUserSession, deriveUserStep, toWatch, pendingForAiCount, sessionChecks } = await import(
    "./session.server"
  );
  const account = await getAccount(userId);
  const { dbSource } = await import("@/lib/db");
  let cred = null;
  try {
    cred = await getCredentialRow(userId);
  } catch {
    cred = null;
  }
  const session = await getUserSession(userId);
  const publicCred = toPublic(cred);
  const watch = toWatch(session, await pendingForAiCount(userId).catch(() => 0));
  const onboarded = Boolean(session?.onboarded_at) || Boolean(publicCred?.onboarded);
  const step = (session
    ? deriveUserStep(session)
    : (publicCred?.step ?? deriveStep(cred))) as TelegramOnboardingStep;
  return {
    configured: Boolean(session?.session_enc) || Boolean(publicCred?.hasToken) || telegramConfigured(),
    mtprotoEnabled: telegramMtprotoEnabled(),
    linked: Boolean(account) && !account?.preview,
    preview: account?.preview ?? false,
    onboarded,
    hasOwnKey: Boolean(session?.session_enc) || Boolean(publicCred?.hasToken),
    platformLogin: telegramConfigured(),
    needsAppKeys: telegramUserApp() === null,
    persistent: dbSource === "neon",
    step,
    credential: publicCred,
    watch,
    checks: sessionChecks(session),
  };
}

async function buildSnapshot(userId: string): Promise<TelegramSnapshot> {
  const { telegramConfigured, telegramMtprotoEnabled } = await import("./config.server");
  const { getAccount, listChats } = await import("./snapshot.server");
  const { getCredentialRow, toPublic } = await import("./credentials.server");
  const { getUserSession, toWatch, pendingForAiCount } = await import("./session.server");
  let cred = null;
  try {
    cred = await getCredentialRow(userId);
  } catch {
    cred = null;
  }
  const session = await getUserSession(userId);
  const account = await getAccount(userId);
  const chats = account ? await listChats(userId) : [];
  const publicCred = toPublic(cred);
  return {
    configured: Boolean(session?.session_enc) || Boolean(publicCred?.hasToken) || telegramConfigured(),
    mtprotoEnabled: telegramMtprotoEnabled(),
    onboarded:
      (Boolean(session?.onboarded_at) && Boolean(session?.session_enc)) ||
      Boolean(publicCred?.onboarded),
    account,
    chats,
    credential: publicCred,
    watch: toWatch(session, await pendingForAiCount(userId).catch(() => 0)),
    generation: Number(session?.account_generation) || 1,
  };
}

export const telegramStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramStatus> => {
    kickAgentLoop(context.userId);
    return buildStatus(context.userId);
  });

export const telegramMeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramSnapshot> => {
    kickAgentLoop(context.userId);
    console.info("[telegram]", { event: "me", userId: context.userId });
    return buildSnapshot(context.userId);
  });

export const telegramStartLoginFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(StartLoginSchema, input))
  .handler(async ({ context, data }): Promise<TelegramStatus> => {
    const { takeRate } = await import("./rate.server");
    const { telegramUserApp } = await import("./config.server");
    const { sendLoginCode } = await import("./mtproto.server");
    const { upsertLoginStart, persistMappedError } = await import("./session.server");
    await takeRate(context.userId, "tg_login", 8, 15 * 60 * 1000);
    const parsed = parsedStartLogin(data, telegramUserApp());
    let sent;
    try {
      sent = await sendLoginCode(parsed);
    } catch (err) {
      await persistMappedError(context.userId, err);
      throw err;
    }
    await upsertLoginStart({
      userId: context.userId,
      apiId: parsed.apiId,
      apiHash: parsed.apiHash,
      phone: parsed.phone,
      phoneCodeHash: sent.phoneCodeHash,
      session: sent.session,
    });
    return buildStatus(context.userId);
  });

export const telegramSubmitCodeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(SubmitCodeSchema, input))
  .handler(async ({ context, data }): Promise<TelegramStatus> => {
    const { upsertLinkedAccount } = await import("./snapshot.server");
    const { takeRate } = await import("./rate.server");
    const { getUserSession, decryptSessionMaterial, saveSignedIn, markNeedsPassword, persistMappedError } = await import(
      "./session.server"
    );
    const { signInWithCode } = await import("./mtproto.server");
    await takeRate(context.userId, "tg_code", 12, 15 * 60 * 1000);
    const row = await getUserSession(context.userId);
    if (!row) throw new TelegramError("invalid", "Start with your phone number first.", 400);
    const material = await decryptSessionMaterial(row);
    if (!material.phoneCodeHash) {
      throw new TelegramError("telegram_login_expired", "That login code expired. Send a new one.", 401);
    }
    let signed;
    try {
      signed = await signInWithCode({
        apiId: material.apiId,
        apiHash: material.apiHash,
        session: material.session,
        phone: material.phone,
        phoneCodeHash: material.phoneCodeHash,
        code: data.code,
      });
    } catch (err) {
      await persistMappedError(context.userId, err);
      throw err;
    }
    if (signed.needsPassword) {
      await markNeedsPassword(context.userId, signed.session);
      return buildStatus(context.userId);
    }
    await saveSignedIn({ userId: context.userId, session: signed.session });
    const me = signedMeOf(signed);
    if (me) {
      await upsertLinkedAccount({
        userId: context.userId,
        telegramUserId: me.telegramUserId,
        firstName: me.firstName,
        lastName: me.lastName,
        username: me.username,
        photoUrl: null,
        botCanWrite: false,
        path: "mtproto",
        preview: false,
      });
    }
    return buildStatus(context.userId);
  });

export const telegramSubmitPasswordFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(SubmitPasswordSchema, input))
  .handler(async ({ context, data }): Promise<TelegramStatus> => {
    const { upsertLinkedAccount } = await import("./snapshot.server");
    const { takeRate } = await import("./rate.server");
    const { getUserSession, decryptSessionMaterial, saveSignedIn, persistMappedError } = await import("./session.server");
    const { signInCloudPassword } = await import("./mtproto.server");
    await takeRate(context.userId, "tg_password", 8, 15 * 60 * 1000);
    const row = await getUserSession(context.userId);
    if (!row) throw new TelegramError("invalid", "Start with your phone number first.", 400);
    const material = await decryptSessionMaterial(row);
    let signed;
    try {
      signed = await signInCloudPassword({
        apiId: material.apiId,
        apiHash: material.apiHash,
        session: material.session,
        password: data.password,
      });
    } catch (err) {
      await persistMappedError(context.userId, err);
      throw err;
    }
    await saveSignedIn({ userId: context.userId, session: signed.session });
    const me = signedMeOf(signed);
    if (me) {
      await upsertLinkedAccount({
        userId: context.userId,
        telegramUserId: me.telegramUserId,
        firstName: me.firstName,
        lastName: me.lastName,
        username: me.username,
        photoUrl: null,
        botCanWrite: false,
        path: "mtproto",
        preview: false,
      });
    }
    return buildStatus(context.userId);
  });

export const telegramStartOidcFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { telegramOidcConfig, telegramRedirectUri } = await import("./config.server");
    const { createOidcTicket } = await import("./snapshot.server");
    const { takeRate } = await import("./rate.server");
    const { newOidcStart } = await import("./oidc");
    const cfg = telegramOidcConfig();
    if (!cfg) throw new TelegramError("not_configured", "Telegram connect isn’t configured.", 503);
    await takeRate(context.userId, "oidc_start", 10, 15 * 60 * 1000);
    const request = getRequest();
    if (!request) throw new TelegramError("invalid", "Missing request.", 500);
    const start = newOidcStart(cfg, telegramRedirectUri(request));
    await createOidcTicket({
      userId: context.userId,
      state: start.state,
      nonce: start.nonce,
      verifier: start.verifier,
    });
    return { url: start.url };
  });

export const telegramSaveKeyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(SaveKeySchema, input))
  .handler(async ({ context, data }): Promise<TelegramCredentialPublic> => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { takeRate } = await import("./rate.server");
    const { saveBotToken, toPublic } = await import("./credentials.server");
    await takeRate(context.userId, "save_key", 8, 15 * 60 * 1000);
    const request = getRequest();
    if (!request) throw new TelegramError("invalid", "Missing request.", 500);
    const row = await saveBotToken(context.userId, data.token, request);
    const pub = toPublic(row);
    if (!pub) throw new TelegramError("invalid", "Could not save the helper key.", 500);
    return pub;
  });

export const telegramAwaitHelloFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramStatus> => {
    const { takeRate } = await import("./rate.server");
    const { refreshHelloPayload, pullUpdates } = await import("./credentials.server");
    await takeRate(context.userId, "hello_poll", 40, 60 * 1000);
    await refreshHelloPayload(context.userId);
    await pullUpdates(context.userId);
    return buildStatus(context.userId);
  });

export const telegramRunCheckFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: TelegramCheckId }) => {
    const id = input?.id;
    if (!id || !CHECK_ID_SET.has(id)) throw new TelegramError("invalid", "Unknown check.", 400);
    return { id };
  })
  .handler(async ({ context }): Promise<TelegramStatus> => {
    const { takeRate } = await import("./rate.server");
    const { runWatchChecks } = await import("./watch.server");
    await takeRate(context.userId, "check", 20, 60 * 1000);
    await runWatchChecks(context.userId);
    return buildStatus(context.userId);
  });

export const telegramRunAllChecksFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramStatus> => {
    const { takeRate } = await import("./rate.server");
    const { runWatchChecks } = await import("./watch.server");
    await takeRate(context.userId, "check_all", 10, 60 * 1000);
    await runWatchChecks(context.userId);
    return buildStatus(context.userId);
  });

export const telegramFinishOnboardingFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramSnapshot> => {
    const { finishWatchOnboarding } = await import("./watch.server");
    await finishWatchOnboarding(context.userId);
    return buildSnapshot(context.userId);
  });

export const telegramEnterPreviewFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(PreviewNameSchema, input ?? {}))
  .handler(async ({ context, data }): Promise<TelegramSnapshot> => {
    const { getAccount, enterPreviewAccount, listChats } = await import("./snapshot.server");
    const existing = await getAccount(context.userId);
    if (existing && !existing.preview) return buildSnapshot(context.userId);
    const name = data.displayName?.trim() || "You";
    await enterPreviewAccount(context.userId, name);
    const chats = await listChats(context.userId);
    const snap = await buildSnapshot(context.userId);
    return { ...snap, chats };
  });

export const telegramMessagesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(MessagesSchema, input))
  .handler(async ({ context, data }): Promise<TelegramMessage[]> => {
    const { listMessages, getChatKind } = await import("./snapshot.server");
    const kind = await getChatKind(context.userId, data.chatId);
    if (kind === "user") {
      const existing = await listMessages(context.userId, data.chatId);
      if (existing.length < 25) {
        const { getUserSession } = await import("./session.server");
        const session = await getUserSession(context.userId);
        if (session?.auth_dead) return existing;
        if (session?.session_enc && session.watching) {
          try {
            const { takeRate } = await import("./rate.server");
            await takeRate(context.userId, "tg_history", 12, 15 * 60 * 1000);
            const { syncWatch } = await import("./watch.server");
            await syncWatch(context.userId, { chatId: data.chatId, historyLimit: 50 });
            return listMessages(context.userId, data.chatId);
          } catch {
            return existing;
          }
        }
      }
      return existing;
    }
    return listMessages(context.userId, data.chatId);
  });

export const telegramSendFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(SendSchema, input))
  .handler(async ({ context, data }): Promise<TelegramMessage> => {
    const { sendNote, getAccount, getChatKind, getChatPeer, appendMessage, findRecentOutbound } = await import(
      "./snapshot.server"
    );
    const { takeRate, takeUserSend } = await import("./rate.server");
    await takeRate(context.userId, "send", 20, 60 * 1000);
    const account = await getAccount(context.userId);
    if (!account) throw new TelegramError("unlinked", "Connect Telegram first.", 404);
    const kind = await getChatKind(context.userId, data.chatId);
    if (kind === "notes") {
      return sendNote(context.userId, data.chatId, data.body, account.displayName);
    }
    if (kind === "user") {
      const peer = await getChatPeer(context.userId, data.chatId);
      if (!peer?.peerId) {
        throw new TelegramError("invalid", "Connect your Telegram account first.", 400);
      }
      const { isServicePeer } = await import("./preview");
      if (isServicePeer(peer.peerId)) {
        throw new TelegramError("invalid", "Telegram service chats are read-only here.", 400);
      }
      const {
        getUserSession,
        decryptSessionMaterial,
        saveSignedIn,
        assertSessionLive,
        persistMappedError,
      } = await import("./session.server");
      const { sendAsUser } = await import("./mtproto.server");
      const { assertPrivatePeerHash } = await import("./peer");
      const row = await getUserSession(context.userId);
      const session = assertSessionLive(row);
      const peerId = peer.peerId;
      if (!session.session_enc || !peerId) {
        throw new TelegramError("invalid", "Connect your Telegram account first.", 400);
      }
      assertPrivatePeerHash(peer.peerKind ?? "user", peer.accessHash);
      const material = await decryptSessionMaterial(session);
      const generation = Number(session.account_generation) || 1;
      const { withMtprotoLease } = await import("./lease.server");
      const { beginSendIntent, completeSendIntent, failSendIntent, sendOutcomeFromError } =
        await import("./send-intent.server");
      // Human send only — agent jobs must never call telegramSendFn (use agentSendToPeer).
      const started = await beginSendIntent({
        userId: context.userId,
        chatId: data.chatId,
        peerId,
        body: data.body,
      });
      if (started.reuse?.status === "sent") {
        const existing = await findRecentOutbound(
          context.userId,
          data.chatId,
          data.body,
          started.reuse.telegramMessageId,
        );
        if (existing) return existing;
        return appendMessage({
          userId: context.userId,
          chatId: data.chatId,
          fromSelf: true,
          authorName: account.displayName,
          body: data.body,
          telegramMessageId: started.reuse.telegramMessageId
            ? Number(started.reuse.telegramMessageId)
            : undefined,
          aiStatus: "outbound",
        });
      }
      try {
        await takeUserSend(context.userId);
      } catch (err) {
        await failSendIntent(
          started.intentId,
          context.userId,
          "failed",
          err instanceof Error ? err.message : "send rate limited",
        );
        throw err;
      }
      try {
        const sent = await withMtprotoLease(context.userId, async () => {
          const result = await sendAsUser({
            apiId: material.apiId,
            apiHash: material.apiHash,
            session: material.session,
            peerId,
            accessHash: peer.accessHash,
            peerKind: peer.peerKind,
            body: data.body,
          });
          await completeSendIntent(started.intentId, context.userId, result.telegramMessageId);
          if (result.session !== material.session) {
            await saveSignedIn({ userId: context.userId, session: result.session, generation });
          }
          return result;
        });
        return appendMessage({
          userId: context.userId,
          chatId: data.chatId,
          fromSelf: true,
          authorName: account.displayName,
          body: data.body,
          telegramMessageId: sent.telegramMessageId,
          aiStatus: "outbound",
        });
      } catch (err) {
        await failSendIntent(
          started.intentId,
          context.userId,
          sendOutcomeFromError(err),
          err instanceof Error ? err.message : "send failed",
        );
        await persistMappedError(context.userId, err);
        throw err;
      }
    }
    if (kind === "bot") {
      const { getDecryptedToken, getCredentialRow } = await import("./credentials.server");
      const { botSendMessage } = await import("./bot.server");
      const token = await getDecryptedToken(context.userId);
      if (!token) throw new TelegramError("invalid", "This chat isn’t available.", 400);
      const cred = await getCredentialRow(context.userId);
      const sent = await botSendMessage(token, account.telegramUserId, data.body);
      return appendMessage({
        userId: context.userId,
        chatId: data.chatId || helperChatId(context.userId),
        fromSelf: false,
        authorName: cred?.bot_name ?? "Helper",
        body: data.body,
        telegramMessageId: sent.message_id,
      });
    }
    throw new TelegramError("invalid", "This chat isn’t available.", 400);
  });

export const telegramUpdateProfileFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(ProfileSchema, input))
  .handler(async ({ context, data }) => {
    const { updateReplicaProfile } = await import("./snapshot.server");
    const { takeRate } = await import("./rate.server");
    await takeRate(context.userId, "profile", 30, 60 * 1000);
    return updateReplicaProfile(context.userId, data);
  });

export const telegramUnlinkFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { unlinkAccount } = await import("./snapshot.server");
    const { deleteCredentials } = await import("./credentials.server");
    const {
      getUserSession,
      decryptSessionMaterial,
      invalidateUserSession,
      wipeUserSession,
    } = await import("./session.server");
    let material: { apiId: number; apiHash: string; session: string } | null = null;
    try {
      const row = await getUserSession(context.userId);
      if (row?.session_enc) {
        material = await decryptSessionMaterial(row);
      }
    } catch {
      /* still disconnect local copy — never log session material */
    }
    await invalidateUserSession(context.userId);
    if (material) {
      try {
        const { revokeSession } = await import("./mtproto.server");
        await revokeSession(material);
      } catch {
        /* still wipe local copy — never log session material */
      }
    }
    await wipeUserSession(context.userId);
    await deleteCredentials(context.userId);
    await unlinkAccount(context.userId);
    console.info("[telegram]", { event: "disconnect", userId: context.userId });
    return { ok: true as const };
  });

export const telegramSetWatchingFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(WatchToggleSchema, input))
  .handler(async ({ context, data }): Promise<TelegramSnapshot> => {
    const { setWatching } = await import("./session.server");
    await setWatching(context.userId, data.watching);
    return buildSnapshot(context.userId);
  });

export const telegramSetAutomationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(AutomationToggleSchema, input))
  .handler(async ({ context, data }): Promise<TelegramSnapshot> => {
    const { setAutomationArmed } = await import("./session.server");
    await setAutomationArmed(context.userId, data.armed);
    return buildSnapshot(context.userId);
  });

export const telegramChatsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramChat[]> => {
    const { listChats } = await import("./snapshot.server");
    return listChats(context.userId);
  });

export const telegramSyncFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(SyncSchema, input ?? {}))
  .handler(async ({ context, data }) => {
    const { takeRate } = await import("./rate.server");
    await takeRate(context.userId, "tg_sync", 8, 60 * 1000);
    const { syncWatch } = await import("./watch.server");
    return syncWatch(context.userId, {
      chatId: data.chatId,
      historyLimit: data.historyLimit,
    });
  });
