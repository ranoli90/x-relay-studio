import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { TelegramError } from "./errors";
import type { TelegramChat, TelegramMessage, TelegramSnapshot, TelegramStatus } from "./types";

export const telegramStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramStatus> => {
    const { telegramConfigured, telegramMtprotoEnabled } = await import("./config.server");
    const { getAccount } = await import("./snapshot.server");
    const account = await getAccount(context.userId);
    return {
      configured: telegramConfigured(),
      mtprotoEnabled: telegramMtprotoEnabled(),
      linked: Boolean(account),
      preview: account?.preview ?? false,
    };
  });

export const telegramMeFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramSnapshot> => {
    const { telegramConfigured, telegramMtprotoEnabled } = await import("./config.server");
    const { getAccount, listChats } = await import("./snapshot.server");
    const account = await getAccount(context.userId);
    const chats = account ? await listChats(context.userId) : [];
    return {
      configured: telegramConfigured(),
      mtprotoEnabled: telegramMtprotoEnabled(),
      account,
      chats,
    };
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
        account: existing,
        chats,
      };
    }
    const name = data.displayName?.trim() || "You";
    const account = await enterPreviewAccount(context.userId, name);
    const chats = await listChats(context.userId);
    const { telegramConfigured, telegramMtprotoEnabled } = await import("./config.server");
    return {
      configured: telegramConfigured(),
      mtprotoEnabled: telegramMtprotoEnabled(),
      account,
      chats,
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
    const { takeRate, sendNote, getAccount } = await import("./snapshot.server");
    await takeRate(context.userId, "send", 60, 60 * 1000);
    const account = await getAccount(context.userId);
    if (!account) throw new TelegramError("unlinked", "Connect Telegram first.", 404);
    return sendNote(context.userId, data.chatId, data.body, account.displayName);
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
    await unlinkAccount(context.userId);
    return { ok: true as const };
  });

export const telegramChatsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<TelegramChat[]> => {
    const { listChats } = await import("./snapshot.server");
    return listChats(context.userId);
  });
