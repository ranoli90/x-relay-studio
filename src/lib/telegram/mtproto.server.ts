/** Server-only Telegram user client. Never import from client code. */
import { TelegramError } from "./errors";

type Teleproto = typeof import("teleproto");

let libPromise: Promise<Teleproto> | null = null;

function loadLib(): Promise<Teleproto> {
  libPromise ??= import("teleproto");
  return libPromise;
}

function clientOpts() {
  return {
    connectionRetries: 1,
    timeout: 12,
    autoReconnect: false,
    useWSS: true,
    deviceModel: "X Relay",
    appVersion: "1.0",
    systemVersion: "Web",
    langCode: "en",
  };
}

function mapRpc(err: unknown): TelegramError {
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
  if (msg.includes("API_ID_INVALID") || msg.includes("API_ID_PUBLISHED_FLOOD")) {
    return new TelegramError(
      "invalid",
      "The Telegram app numbers didn’t work. Copy them again from my.telegram.org.",
      400,
    );
  }
  if (msg.includes("FLOOD") || msg.includes("WAIT")) {
    return new TelegramError("flood", "Telegram asked us to wait. Try again in a few minutes.", 429);
  }
  if (msg.includes("AUTH_KEY") || msg.includes("SESSION_REVOKED") || msg.includes("SESSION_EXPIRED")) {
    return new TelegramError("unlinked", "Telegram signed this desk out. Connect again.", 401);
  }
  console.info("[telegram]", { event: "mtproto_error", message: raw.slice(0, 180) });
  return new TelegramError("invalid", "Telegram didn’t accept that. Try again.", 400);
}

async function withClient<T>(
  opts: { apiId: number; apiHash: string; session: string },
  fn: (bundle: { client: InstanceType<Teleproto["TelegramClient"]>; lib: Teleproto }) => Promise<T>,
): Promise<{ result: T; session: string }> {
  const lib = await loadLib();
  const sessionObj = new lib.sessions.StringSession(opts.session);
  const client = new lib.TelegramClient(sessionObj, opts.apiId, opts.apiHash, clientOpts());
  try {
    await client.connect();
    const result = await fn({ client, lib });
    const session = String(client.session.save() ?? opts.session);
    return { result, session };
  } catch (err) {
    if (err instanceof TelegramError) throw err;
    if (err instanceof lib.errors.SessionPasswordNeededError) {
      const session = String(client.session.save() ?? opts.session);
      const wrapped = new TelegramError("password", "This account uses a cloud password.", 401);
      (wrapped as TelegramError & { session: string }).session = session;
      throw wrapped;
    }
    throw mapRpc(err);
  } finally {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export async function sendLoginCode(opts: {
  apiId: number;
  apiHash: string;
  phone: string;
}): Promise<{ phoneCodeHash: string; session: string }> {
  try {
    const { result, session } = await withClient(
      { apiId: opts.apiId, apiHash: opts.apiHash, session: "" },
      async ({ client }) =>
        client.sendCode({ apiId: opts.apiId, apiHash: opts.apiHash }, opts.phone),
    );
    if (!result.phoneCodeHash) {
      throw new TelegramError("invalid", "Telegram didn’t send a login code.", 500);
    }
    return { phoneCodeHash: result.phoneCodeHash, session };
  } catch (err) {
    if (err instanceof TelegramError) throw err;
    throw mapRpc(err);
  }
}

export async function signInWithCode(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  phone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<{ session: string; needsPassword: boolean }> {
  try {
    const { session } = await withClient(
      { apiId: opts.apiId, apiHash: opts.apiHash, session: opts.session },
      async ({ client, lib }) => {
        await client.invoke(
          new lib.Api.auth.SignIn({
            phoneNumber: opts.phone,
            phoneCodeHash: opts.phoneCodeHash,
            phoneCode: opts.code,
          }),
        );
      },
    );
    return { session, needsPassword: false };
  } catch (err) {
    if (err instanceof TelegramError && err.code === "password") {
      const session = (err as TelegramError & { session?: string }).session ?? opts.session;
      return { session, needsPassword: true };
    }
    throw err;
  }
}

export async function signInCloudPassword(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  password: string;
}): Promise<{ session: string }> {
  const { session } = await withClient(
    { apiId: opts.apiId, apiHash: opts.apiHash, session: opts.session },
    async ({ client }) => {
      await client.signInWithPassword(
        { apiId: opts.apiId, apiHash: opts.apiHash },
        {
          password: async () => opts.password,
          onError: async () => true,
        },
      );
    },
  );
  return { session };
}

export type TelegramMe = {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
};

export async function fetchMe(opts: {
  apiId: number;
  apiHash: string;
  session: string;
}): Promise<{ me: TelegramMe; session: string }> {
  const { result, session } = await withClient(opts, async ({ client }) => {
    const me = await client.getMe();
    const id = Number(me.id);
    if (!Number.isFinite(id)) throw new TelegramError("invalid", "Could not read that Telegram account.", 500);
    return {
      telegramUserId: id,
      firstName: me.firstName?.trim() || "Telegram",
      lastName: me.lastName?.trim() || null,
      username: me.username?.trim() || null,
    };
  });
  return { me: result, session };
}

export type PulledDialog = {
  chatId: string;
  peerId: string;
  title: string;
  unread: number;
  pinned: boolean;
  muted: boolean;
  lastPreview: string | null;
  lastAt: string | null;
  entity: unknown;
};

export type PulledMessage = {
  telegramMessageId: number;
  fromSelf: boolean;
  authorName: string;
  body: string;
  createdAt: string;
};

function dialogId(dialog: { id?: unknown }): string {
  const raw = String(dialog.id ?? "");
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  return `tg_${safe}`.slice(0, 160);
}

function dialogTitle(dialog: Record<string, unknown>): string {
  const entity = (dialog.entity ?? dialog) as Record<string, unknown>;
  const title = entity.title ?? entity.firstName;
  if (typeof title === "string" && title.trim()) {
    const last = typeof entity.lastName === "string" ? entity.lastName.trim() : "";
    return last && !entity.title ? `${title} ${last}`.trim() : title.trim();
  }
  return "Telegram";
}

function messageBody(msg: Record<string, unknown>): string {
  if (typeof msg.message === "string" && msg.message.trim()) return msg.message.trim().slice(0, 4000);
  if (msg.media) return "[media]";
  if (msg.action) return "[event]";
  return "";
}

export async function pullDialogs(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  limit?: number;
}): Promise<{ dialogs: PulledDialog[]; session: string }> {
  const { result, session } = await withClient(
    { apiId: opts.apiId, apiHash: opts.apiHash, session: opts.session },
    async ({ client }) => {
      const raw = (await client.getDialogs({ limit: opts.limit ?? 40 })) as unknown as Record<
        string,
        unknown
      >[];
      return raw.map((d) => {
        const unread = Number(d.unreadCount ?? 0);
        const date = d.date ? new Date(Number(d.date) * 1000).toISOString() : null;
        const message = d.message as Record<string, unknown> | undefined;
        return {
          chatId: dialogId(d as { id?: unknown }),
          peerId: String(d.id ?? ""),
          title: dialogTitle(d),
          unread: Number.isFinite(unread) ? unread : 0,
          pinned: Boolean(d.pinned),
          muted: Boolean(d.archived),
          lastPreview: message ? messageBody(message).slice(0, 140) || null : null,
          lastAt: date,
          entity: d.entity ?? d.id,
        } satisfies PulledDialog;
      });
    },
  );
  return { dialogs: result, session };
}

export async function pullHistory(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  entity: unknown;
  limit?: number;
  selfId: number;
}): Promise<{ messages: PulledMessage[]; session: string }> {
  const { result, session } = await withClient(
    { apiId: opts.apiId, apiHash: opts.apiHash, session: opts.session },
    async ({ client }) => {
      const raw = (await client.getMessages(opts.entity as never, {
        limit: opts.limit ?? 40,
      })) as unknown as Record<string, unknown>[];
      const out: PulledMessage[] = [];
      for (const msg of raw) {
        const id = Number(msg.id);
        const body = messageBody(msg);
        if (!Number.isFinite(id) || !body) continue;
        const sender = (msg.sender ?? msg.fromId ?? {}) as Record<string, unknown>;
        const fromSelf = Boolean(msg.out) || Number(sender.id) === opts.selfId;
        const author =
          (typeof sender.firstName === "string" && sender.firstName) ||
          (typeof sender.title === "string" && sender.title) ||
          (fromSelf ? "You" : "Telegram");
        const createdAt = msg.date
          ? new Date(Number(msg.date) * 1000).toISOString()
          : new Date().toISOString();
        out.push({
          telegramMessageId: id,
          fromSelf,
          authorName: String(author),
          body,
          createdAt,
        });
      }
      return out.reverse();
    },
  );
  return { messages: result, session };
}

export async function sendAsUser(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  peerId: string;
  body: string;
}): Promise<{ telegramMessageId: number | null; session: string }> {
  const { result, session } = await withClient(
    { apiId: opts.apiId, apiHash: opts.apiHash, session: opts.session },
    async ({ client }) => {
      const peer = /^-?\d+$/.test(opts.peerId) ? BigInt(opts.peerId) : opts.peerId;
      const sent = await client.sendMessage(peer as never, { message: opts.body });
      return Number.isFinite(Number(sent?.id)) ? Number(sent.id) : null;
    },
  );
  return { telegramMessageId: result, session };
}
