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

const CHECK_ID_SET = new Set<string>(TELEGRAM_CHECK_IDS);

async function buildStatus(userId: string): Promise<TelegramStatus> {
  const { telegramConfigured, telegramMtprotoEnabled } = await import("./config.server");
  const { getAccount } = await import("./snapshot.server");
  const { getCredentialRow, toPublic, deriveStep } = await import("./credentials.server");
  const account = await getAccount(userId);
  let cred = null;
  try {
    cred = await getCredentialRow(userId);
  } catch {
    cred = null;
  }
  const publicCred = toPublic(cred);
  const platformLogin = telegramConfigured();
  const onboarded = Boolean(publicCred?.onboarded);
  return {
    configured: Boolean(publicCred?.hasToken) || platformLogin,
    mtprotoEnabled: telegramMtprotoEnabled(),
    linked: Boolean(account) && !account?.preview,
    preview: account?.preview ?? false,
    onboarded,
    hasOwnKey: Boolean(publicCred?.hasToken),
    platformLogin,
    step: (publicCred?.step ?? deriveStep(cred)) as TelegramOnboardingStep,
    credential: publicCred,
  };
}

async function buildSnapshot(userId: string): Promise<TelegramSnapshot> {
  const { telegramConfigured, telegramMtprotoEnabled } = await import("./config.server");
  const { getAccount, listChats } = await import("./snapshot.server");
  const { getCredentialRow, toPublic } = await import("./credentials.server");
  let cred = null;
  try {
    cred = await getCredentialRow(userId);
  } catch {
    cred = null;
  }
  const account = await getAccount(userId);
  const chats = account ? await listChats(userId) : [];
  const publicCred = toPublic(cred);
  return {
    configured: Boolean(publicCred?.hasToken) || telegramConfigured(),
    mtprotoEnabled: telegramMtprotoEnabled(),
    onboarded: Boolean(publicCred?.onboarded),
    account,
    chats,
    credential: publicCred,
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
    console.info("[telegram]", { event: "oidc_start", userId: context.userId });
    return { url: start.url };
  });

export const telegramSaveKeyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { token: string }) => ({ token: String(input?.token ?? "") }))
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
  .handler(async ({ context, data }): Promise<TelegramStatus> => {
    const { takeRate } = await import("./snapshot.server");
    const { runOneCheck } = await import("./checks.server");
    await takeRate(context.userId, "check", 40, 60 * 1000);
    await runOneCheck(context.userId, data.id);
    return buildStatus(context.userId);
  });

export const telegramRunAllChecksFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramStatus> => {
    const { takeRate } = await import("./snapshot.server");
    const { runAllChecks } = await import("./checks.server");
    await takeRate(context.userId, "check_all", 10, 60 * 1000);
    await runAllChecks(context.userId);
    return buildStatus(context.userId);
  });

export const telegramFinishOnboardingFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramSnapshot> => {
    const { finishOnboarding } = await import("./checks.server");
    await finishOnboarding(context.userId);
    return buildSnapshot(context.userId);
  });

export const telegramEnterPreviewFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { displayName?: string }) => input)
  .handler(async ({ context, data }): Promise<TelegramSnapshot> => {
    const { getAccount, enterPreviewAccount, listChats } = await import("./snapshot.server");
    const existing = await getAccount(context.userId);
    if (existing && !existing.preview) {
      const chats = await listChats(context.userId);
      return {
        configured: true,
        mtprotoEnabled: false,
        onboarded: true,
        account: existing,
        chats,
        credential: null,
      };
    }
    const name = data.displayName?.trim() || "You";
    const account = await enterPreviewAccount(context.userId, name);
    const chats = await listChats(context.userId);
    return {
      configured: true,
      mtprotoEnabled: false,
      onboarded: false,
      account,
      chats,
      credential: null,
    };
  });

export const telegramMessagesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { chatId: string }) => input)
  .handler(async ({ context, data }): Promise<TelegramMessage[]> => {
    const { listMessages } = await import("./snapshot.server");
    return listMessages(context.userId, data.chatId);
  });

export const telegramSendFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { chatId: string; body: string }) => input)
  .handler(async ({ context, data }): Promise<TelegramMessage> => {
    const { takeRate, sendNote, getAccount, getChatKind, appendMessage } = await import(
      "./snapshot.server"
    );
    await takeRate(context.userId, "send", 60, 60 * 1000);
    const account = await getAccount(context.userId);
    if (!account) throw new TelegramError("unlinked", "Connect Telegram first.", 404);
    const kind = await getChatKind(context.userId, data.chatId);
    if (kind === "notes") {
      return sendNote(context.userId, data.chatId, data.body, account.displayName);
    }
    if (kind === "bot") {
      const { getDecryptedToken } = await import("./credentials.server");
      const { botSendMessage } = await import("./bot.server");
      const token = await getDecryptedToken(context.userId);
      if (!token) throw new TelegramError("invalid", "Save a helper key first.", 400);
      await botSendMessage(token, account.telegramUserId, data.body.trim());
      return appendMessage({
        userId: context.userId,
        chatId: data.chatId || helperChatId(context.userId),
        fromSelf: true,
        authorName: account.displayName,
        body: data.body,
      });
    }
    throw new TelegramError("invalid", "This path can only write Studio notes or helper chats.", 400);
  });

export const telegramUpdateProfileFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { firstName: string; lastName: string; about: string }) => input)
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
    await deleteCredentials(context.userId);
    await unlinkAccount(context.userId);
    return { ok: true as const };
  });

export const telegramChatsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramChat[]> => {
    const { listChats } = await import("./snapshot.server");
    return listChats(context.userId);
  });
