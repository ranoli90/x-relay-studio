/** Server-only Telegram user client. Never import from client code. */
import { TelegramError } from "./errors";
import { floodWaitSeconds, mtprotoClientOpts } from "./mtproto-policy.server";

type Teleproto = typeof import("teleproto");

let libPromise: Promise<Teleproto> | null = null;

function loadLib(): Promise<Teleproto> {
  libPromise ??= import("teleproto").then((mod) => {
    const lib = (mod as { default?: Teleproto }).default ?? (mod as Teleproto);
    if (!lib?.TelegramClient || !lib.sessions) {
      throw new TelegramError("not_configured", "Telegram client failed to load on this server.", 500);
    }
    return lib;
  });
  return libPromise;
}

function clientOpts() {
  return mtprotoClientOpts();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TelegramError("flood", `Telegram took too long (${label}). Tap try again.`, 504));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function mapRpc(err: unknown): TelegramError {
  if (err instanceof TelegramError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toUpperCase();
  if (msg.includes("PHONE_NUMBER_INVALID") || msg.includes("PHONE_NUMBER_BANNED")) {
    return new TelegramError("invalid", "That phone number didn’t work. Check the country code.", 400);
  }
  if (msg.includes("PHONE_CODE_INVALID") || msg.includes("PHONE_CODE_EMPTY")) {
    return new TelegramError("invalid", "That login code didn’t match. Try again.", 400);
  }
  if (msg.includes("PHONE_CODE_EXPIRED")) {
    return new TelegramError("telegram_login_expired", "That login code expired. Send a new one.", 401);
  }
  if (msg.includes("PASSWORD_HASH_INVALID") || msg.includes("PASSWORD_EMPTY")) {
    return new TelegramError("invalid", "That cloud password didn’t match.", 400);
  }
  if (msg.includes("SESSION_PASSWORD_NEEDED") || msg.includes("PASSWORD_REQUIRED")) {
    return new TelegramError("password", "Cloud password required.", 401);
  }
  if (msg.includes("API_ID_INVALID") || msg.includes("API_ID_PUBLISHED_FLOOD")) {
    return new TelegramError(
      "invalid",
      "The Telegram app numbers didn’t work. Copy them again from my.telegram.org.",
      400,
    );
  }
  const wait = floodWaitSeconds(raw);
  if (wait != null) {
    return new TelegramError(
      "flood",
      `Telegram asked us to wait ${wait} second${wait === 1 ? "" : "s"}.`,
      429,
    );
  }
  if (msg.includes("FLOOD") || (msg.includes("WAIT") && msg.includes("SECOND"))) {
    return new TelegramError("flood", "Telegram asked us to wait. Try again in a few minutes.", 429);
  }
  if (msg.includes("AUTH_KEY") || msg.includes("SESSION_REVOKED") || msg.includes("SESSION_EXPIRED")) {
    return new TelegramError("unlinked", "Telegram signed this desk out. Connect again.", 401);
  }
  if (
    msg.includes("CONNECTION") ||
    msg.includes("CONNECT") ||
    msg.includes("NETSOCKET") ||
    msg.includes("WAS LOST") ||
    msg.includes("TOOK TOO LONG") ||
    msg.includes("ECONN") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("TIMEOUT") ||
    msg.includes(" DC ")
  ) {
    return new TelegramError("flood", "Couldn't refresh Telegram just now.", 503);
  }
  if (msg.includes("CANNOT FIND PACKAGE") || msg.includes("CANNOT FIND MODULE")) {
    return new TelegramError("not_configured", "Telegram client failed to load on this server. Try again in a minute.", 500);
  }
  console.info("[telegram]", { event: "mtproto_error", message: raw.slice(0, 180) });
  return new TelegramError("invalid", "Telegram didn’t accept that. Try again.", 400);
}

type Creds = { apiId: number; apiHash: string; session?: string };

async function openClient(creds: Creds) {
  const lib = await loadLib();
  const session = new lib.sessions.StringSession(creds.session ?? "");
  const client = new lib.TelegramClient(session, creds.apiId, creds.apiHash, clientOpts());
  await withTimeout(client.connect(), 12_000, "connect");
  return { lib, client, save: () => String(client.session.save() ?? creds.session ?? "") };
}

async function closeClient(client: { disconnect?: () => Promise<void> | void }) {
  try {
    await client.disconnect?.();
  } catch {
    /* ignore */
  }
}

export async function sendLoginCode(opts: {
  apiId: number;
  apiHash: string;
  phone: string;
}): Promise<{ phoneCodeHash: string; session: string }> {
  const { client, save } = await openClient(opts);
  try {
    const sent = await withTimeout(
      client.sendCode({ apiId: opts.apiId, apiHash: opts.apiHash }, opts.phone),
      15_000,
      "send code",
    );
    const phoneCodeHash = String(
      (sent as { phoneCodeHash?: string; phone_code_hash?: string }).phoneCodeHash ??
        (sent as { phone_code_hash?: string }).phone_code_hash ??
        "",
    );
    if (!phoneCodeHash) {
      throw new TelegramError("invalid", "Telegram did not send a login code.", 400);
    }
    return { phoneCodeHash, session: save() };
  } catch (err) {
    throw mapRpc(err);
  } finally {
    await closeClient(client);
  }
}

export async function signInWithCode(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  phone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<{ needsPassword: boolean; session: string }> {
  const { lib, client, save } = await openClient(opts);
  try {
    await withTimeout(
      client.invoke(
        new lib.Api.auth.SignIn({
          phoneNumber: opts.phone,
          phoneCodeHash: opts.phoneCodeHash,
          phoneCode: opts.code,
        }),
      ),
      15_000,
      "sign in",
    );
    return { needsPassword: false, session: save() };
  } catch (err) {
    const mapped = mapRpc(err);
    if (mapped.code === "password" || /SESSION_PASSWORD_NEEDED/i.test(String(err))) {
      return { needsPassword: true, session: save() };
    }
    throw mapped;
  } finally {
    await closeClient(client);
  }
}

export async function signInCloudPassword(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  password: string;
}): Promise<{ session: string }> {
  const { client, save } = await openClient(opts);
  try {
    await withTimeout(
      client.signInWithPassword(
        { apiId: opts.apiId, apiHash: opts.apiHash },
        {
          password: async () => opts.password,
          onError: async () => true,
        },
      ),
      20_000,
      "cloud password",
    );
    return { session: save() };
  } catch (err) {
    throw mapRpc(err);
  } finally {
    await closeClient(client);
  }
}

export async function fetchMe(opts: Creds): Promise<{
  me: {
    telegramUserId: number;
    firstName: string;
    lastName: string | null;
    username: string | null;
  };
  session: string;
}> {
  const { client, save } = await openClient(opts);
  try {
    const me = await withTimeout(client.getMe(), 12_000, "me");
    const raw = me as unknown as {
      id?: number | string | { toString(): string };
      firstName?: string;
      lastName?: string | null;
      username?: string | null;
    };
    const id = Number(raw.id ?? 0);
    return {
      me: {
        telegramUserId: id,
        firstName: String(raw.firstName ?? "You"),
        lastName: raw.lastName ?? null,
        username: raw.username ?? null,
      },
      session: save(),
    };
  } catch (err) {
    throw mapRpc(err);
  } finally {
    await closeClient(client);
  }
}

export type InboxDialog = {
  chatId: string;
  title: string;
  peerId: string;
  unread: number;
  pinned: boolean;
  muted: boolean;
  lastPreview: string | null;
  lastAt: string | null;
};

export type InboxMessage = {
  fromSelf: boolean;
  authorName: string;
  body: string;
  telegramMessageId: number;
  createdAt: string;
};

async function asList(raw: unknown): Promise<unknown[]> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && Symbol.asyncIterator in raw) {
    const out: unknown[] = [];
    for await (const item of raw as AsyncIterable<unknown>) out.push(item);
    return out;
  }
  return [];
}

export async function pullInbox(opts: Creds & {
  selfId: number;
  dialogLimit?: number;
  historyLimit?: number;
  historyChats?: number;
  skipPhotoPeers?: string[];
  photoLimit?: number;
  focusChatId?: string | null;
}): Promise<{ dialogs: InboxDialog[]; histories: { chatId: string; messages: InboxMessage[] }[]; session: string }> {
  const { client, save } = await openClient(opts);
  try {
    const dialogsRaw = await withTimeout(
      client.getDialogs({ limit: opts.dialogLimit ?? 40 }),
      18_000,
      "dialogs",
    );
    const dialogs: InboxDialog[] = [];
    const histories: { chatId: string; messages: InboxMessage[] }[] = [];
    const list = await asList(dialogsRaw);
    for (const d of list) {
      const entity = (d as { entity?: { id?: number | string; title?: string; firstName?: string; username?: string } }).entity;
      const id = String(entity?.id ?? (d as { id?: number | string }).id ?? "");
      if (!id) continue;
      const title =
        entity?.title ||
        entity?.firstName ||
        entity?.username ||
        (d as { title?: string }).title ||
        "Chat";
      const unread = Number((d as { unreadCount?: number }).unreadCount ?? 0);
      const pinned = Boolean((d as { pinned?: boolean }).pinned);
      const message = (d as { message?: { message?: string; date?: number } }).message;
      dialogs.push({
        chatId: id,
        title,
        peerId: id,
        unread,
        pinned,
        muted: false,
        lastPreview: message?.message?.slice(0, 140) ?? null,
        lastAt: message?.date ? new Date(message.date * 1000).toISOString() : null,
      });
    }

    const focus = opts.focusChatId ? String(opts.focusChatId).replace(/^.*_/, "") : null;
    const targets = focus
      ? dialogs.filter((d) => d.chatId === focus || d.peerId === focus)
      : dialogs.slice(0, Math.max(1, opts.historyChats ?? 6));

    for (const t of targets) {
      try {
        const msgs = await withTimeout(
          client.getMessages(t.peerId, { limit: opts.historyLimit ?? 40 }),
          18_000,
          "history",
        );
        const mapped: InboxMessage[] = [];
        for (const m of await asList(msgs)) {
          const body = String((m as { message?: string }).message ?? "").trim();
          if (!body) continue;
          const sender = (m as { sender?: { firstName?: string; username?: string } }).sender;
          const out = Boolean((m as { out?: boolean }).out);
          const mid = Number((m as { id?: number }).id ?? 0);
          const date = Number((m as { date?: number }).date ?? 0);
          mapped.push({
            fromSelf: out,
            authorName: sender?.firstName || sender?.username || (out ? "You" : t.title),
            body,
            telegramMessageId: mid,
            createdAt: date ? new Date(date * 1000).toISOString() : new Date().toISOString(),
          });
        }
        histories.push({ chatId: t.chatId, messages: mapped.reverse() });
      } catch (err) {
        console.info("[telegram]", { event: "history_miss", chatId: t.chatId, err: String(err).slice(0, 80) });
      }
    }
    return { dialogs, histories, session: save() };
  } catch (err) {
    throw mapRpc(err);
  } finally {
    await closeClient(client);
  }
}

export async function sendAsUser(opts: Creds & {
  peerId: string;
  body: string;
}): Promise<{ session: string; telegramMessageId: number }> {
  const { client, save } = await openClient(opts);
  try {
    const sent = await withTimeout(client.sendMessage(opts.peerId, { message: opts.body }), 15_000, "send");
    const id = Number((sent as { id?: number }).id ?? 0);
    return { session: save(), telegramMessageId: id };
  } catch (err) {
    throw mapRpc(err);
  } finally {
    await closeClient(client);
  }
}

export async function revokeSession(opts: Creds): Promise<void> {
  const { lib, client } = await openClient(opts);
  try {
    await withTimeout(client.invoke(new lib.Api.auth.LogOut()), 10_000, "logout");
  } catch (err) {
    throw mapRpc(err);
  } finally {
    await closeClient(client);
  }
}
