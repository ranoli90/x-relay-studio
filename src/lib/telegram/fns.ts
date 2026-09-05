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
  parseOrThrow,
  parsedStartLogin,
} from "./validate";

const CHECK_ID_SET = new Set<string>(TELEGRAM_CHECK_IDS);

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
    onboarded: Boolean(session?.onboarded_at) || Boolean(publicCred?.onboarded),
    account,
    chats,
    credential: publicCred,
    watch: toWatch(session, await pendingForAiCount(userId).catch(() => 0)),
  };
}

export const telegramStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramStatus> => buildStatus(context.userId));

export const telegramMeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramSnapshot> => {
    console.info("[telegram]", { event: "me", userId: context.userId });
    return buildSnapshot(context.userId);
  });

export const telegramStartLoginFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(StartLoginSchema, input))
  .handler(async ({ context, data }): Promise<TelegramStatus> => {
    const { takeRate } = await import("./snapshot.server");
    const { telegramUserApp } = await import("./config.server");
    const { sendLoginCode } = await import("./mtproto.server");
    const { upsertLoginStart } = await import("./session.server");
    await takeRate(context.userId, "tg_login", 8, 15 * 60 * 1000);
    const parsed = parsedStartLogin(data, telegramUserApp());
    const sent = await sendLoginCode(parsed);
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
    const { takeRate, upsertLinkedAccount } = await import("./snapshot.server");
    const { getUserSession, decryptSessionMaterial, saveSignedIn, markNeedsPassword } = await import(
      "./session.server"
    );
    const { signInWithCode, fetchMe } = await import("./mtproto.server");
    await takeRate(context.userId, "tg_code", 12, 15 * 60 * 1000);
    const row = await getUserSession(context.userId);
    if (!row) throw new TelegramError("invalid", "Start with your phone number first.", 400);
    const material = await decryptSessionMaterial(row);
    if (!material.phoneCodeHash) {
      throw new TelegramError("telegram_login_expired", "That login code expired. Send a new one.", 401);
    }
    const signed = await signInWithCode({
      apiId: material.apiId,
      apiHash: material.apiHash,
      session: material.session,
      phone: material.phone,
      phoneCodeHash: material.phoneCodeHash,
      code: data.code,
    });
    if (signed.needsPassword) {
      await markNeedsPassword(context.userId, signed.session);
      return buildStatus(context.userId);
    }
    await saveSignedIn({ userId: context.userId, session: signed.session });
    const { me } = await fetchMe({
      apiId: material.apiId,
      apiHash: material.apiHash,
      session: signed.session,
    });
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
    return buildStatus(context.userId);
  });

export const telegramSubmitPasswordFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(SubmitPasswordSchema, input))
  .handler(async ({ context, data }): Promise<TelegramStatus> => {
    const { takeRate, upsertLinkedAccount } = await import("./snapshot.server");
    const { getUserSession, decryptSessionMaterial, saveSignedIn } = await import("./session.server");
    const { signInCloudPassword, fetchMe } = await import("./mtproto.server");
    await takeRate(context.userId, "tg_password", 8, 15 * 60 * 1000);
    const row = await getUserSession(context.userId);
    if (!row) throw new TelegramError("invalid", "Start with your phone number first.", 400);
    const material = await decryptSessionMaterial(row);
    const signed = await signInCloudPassword({
      apiId: material.apiId,
      apiHash: material.apiHash,
      session: material.session,
      password: data.password,
    });
    await saveSignedIn({ userId: context.userId, session: signed.session });
    const { me } = await fetchMe({
      apiId: material.apiId,
      apiHash: material.apiHash,
      session: signed.session,
    });
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
    return buildStatus(context.userId);
  });

export const telegramStartOidcFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ url: string }> => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { telegramOidcConfig, telegramRedirectUri } = await import("./config.server");
    const { takeRate, createOidcTicket } = await import("./snapshot.server");
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
    const { takeRate } = await import("./snapshot.server");
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
    const { takeRate } = await import("./snapshot.server");
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
    const { takeRate } = await import("./snapshot.server");
    const { runWatchChecks } = await import("./watch.server");
    await takeRate(context.userId, "check", 20, 60 * 1000);
    await runWatchChecks(context.userId);
    return buildStatus(context.userId);
  });

export const telegramRunAllChecksFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramStatus> => {
    const { takeRate } = await import("./snapshot.server");
    const { runWatchChecks } = await import("./watch.server");
    await takeRate(context.userId, "check_all", 10, 60 * 1000);
    await runWatchChecks(context.userId);
    return buildStatus(context.userId);
  });

export const telegramFinishOnboardingFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramSnapshot> => {
    const { finishWatchOnboarding, syncWatch } = await import("./watch.server");
    await finishWatchOnboarding(context.userId);
    await syncWatch(context.userId, { historyLimit: 20 }).catch(() => null);
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
    const { listMessages } = await import("./snapshot.server");
    return listMessages(context.userId, data.chatId);
  });

export const telegramSendFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(SendSchema, input))
  .handler(async ({ context, data }): Promise<TelegramMessage> => {
    const { takeRate, sendNote, getAccount, getChatKind, getChatPeer, appendMessage } = await import(
      "./snapshot.server"
    );
    await takeRate(context.userId, "send", 60, 60 * 1000);
    const account = await getAccount(context.userId);
    if (!account) throw new TelegramError("unlinked", "Connect Telegram first.", 404);
    const kind = await getChatKind(context.userId, data.chatId);
    if (kind === "notes") {
      return sendNote(context.userId, data.chatId, data.body, account.displayName);
    }
    if (kind === "user") {
      const peer = await getChatPeer(context.userId, data.chatId);
      const { getUserSession, decryptSessionMaterial, saveSignedIn } = await import("./session.server");
      const { sendAsUser } = await import("./mtproto.server");
      const row = await getUserSession(context.userId);
      if (!row?.session_enc || !peer?.peerId) {
        throw new TelegramError("invalid", "Connect your Telegram account first.", 400);
      }
      const material = await decryptSessionMaterial(row);
      const sent = await sendAsUser({
        apiId: material.apiId,
        apiHash: material.apiHash,
        session: material.session,
        peerId: peer.peerId,
        body: data.body,
      });
      if (sent.session !== material.session) {
        await saveSignedIn({ userId: context.userId, session: sent.session });
      }
      return appendMessage({
        userId: context.userId,
        chatId: data.chatId,
        fromSelf: true,
        authorName: account.displayName,
        body: data.body,
        telegramMessageId: sent.telegramMessageId,
        aiStatus: "outbound",
      });
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
    const { takeRate, updateReplicaProfile } = await import("./snapshot.server");
    await takeRate(context.userId, "profile", 30, 60 * 1000);
    return updateReplicaProfile(context.userId, data);
  });

export const telegramUnlinkFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { unlinkAccount } = await import("./snapshot.server");
    const { deleteCredentials } = await import("./credentials.server");
    const { deleteUserSession } = await import("./session.server");
    await deleteUserSession(context.userId);
    await deleteCredentials(context.userId);
    await unlinkAccount(context.userId);
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

export const telegramChatsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramChat[]> => {
    const { listChats } = await import("./snapshot.server");
    return listChats(context.userId);
  });

export const telegramSyncFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseOrThrow(SyncSchema, input ?? {}))
  .handler(
    async ({
      context,
      data,
    }): Promise<{
      chats: TelegramChat[];
      messages: TelegramMessage[];
      watch: TelegramSnapshot["watch"];
    }> => {
      const { getUserSession } = await import("./session.server");
      const session = await getUserSession(context.userId);
      if (session?.session_enc && session.watching) {
        const { syncWatch } = await import("./watch.server");
        const pulled = await syncWatch(context.userId, { chatId: data.chatId ?? null });
        return { ...pulled, watch: (await buildSnapshot(context.userId)).watch };
      }
      try {
        const { pullUpdates } = await import("./credentials.server");
        await pullUpdates(context.userId);
      } catch {
        /* no helper key */
      }
      const { listChats, listMessages } = await import("./snapshot.server");
      const chats = await listChats(context.userId);
      const messages = data.chatId ? await listMessages(context.userId, data.chatId) : [];
      return { chats, messages, watch: (await buildSnapshot(context.userId)).watch };
    },
  );
