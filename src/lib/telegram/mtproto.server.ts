/** Server-only Telegram user client. Never import from client code. */
import { TelegramError } from "./errors";
import { mapRpc, redactRpcMessage } from "./map-rpc";
import {
  isAccountFrozen,
  isAuthKeyDuplicated,
  isDcConnectFailure,
  isPeerFlood,
  mtprotoClientOpts,
  type MtprotoTransport,
} from "./mtproto-policy.server";
import {
  assertPrivatePeerHash,
  historyFailureKind,
  isCollapsedHistoryMiss,
  parseAccessHash,
  peerKindFromEntity,
  peerKindFromId,
  type TelegramPeerKind,
} from "./peer";

export { mapRpc } from "./map-rpc";

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

function clientOpts(transport: MtprotoTransport) {
  return mtprotoClientOpts(transport);
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

type Creds = { apiId: number; apiHash: string; session?: string };

function connectTransports(): MtprotoTransport[] {
  if (process.env.TELEGRAM_MTPROTO_WSS === "true") return ["wss"];
  if (process.env.TELEGRAM_MTPROTO_WSS === "false") return ["tcp"];
  return ["tcp", "wss"];
}

function isRetryableConnect(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    isDcConnectFailure(raw) ||
    /CONNECT|TIMEOUT|SOCKET|WSS|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(raw)
  );
}

async function closeClient(client: { disconnect?: () => Promise<void> | void }) {
  try {
    await client.disconnect?.();
  } catch {
    /* ignore */
  }
}

type Opened = {
  lib: Teleproto;
  client: InstanceType<Teleproto["TelegramClient"]>;
  save: () => string;
};

async function openClient(creds: Creds): Promise<Opened> {
  const lib = await loadLib();
  const transports = connectTransports();
  let last: unknown;
  for (let i = 0; i < transports.length; i++) {
    const transport = transports[i];
    const session = new lib.sessions.StringSession(creds.session ?? "");
    const client = new lib.TelegramClient(session, creds.apiId, creds.apiHash, clientOpts(transport));
    try {
      await withTimeout(client.connect(), 22_000, "connect");
      return { lib, client, save: () => String(client.session.save() ?? creds.session ?? "") };
    } catch (err) {
      last = err;
      await closeClient(client);
      const raw = err instanceof Error ? err.message : String(err);
      if (isAuthKeyDuplicated(raw) || isPeerFlood(raw) || isAccountFrozen(raw)) {
        throw mapRpc(err);
      }
      const canFallback = i < transports.length - 1 && isRetryableConnect(err);
      console.info("[telegram]", {
        event: canFallback ? "mtproto_transport_fallback" : "mtproto_connect_failed",
        transport,
        message: redactRpcMessage(raw),
      });
      if (!canFallback) throw mapRpc(err);
    }
  }
  throw mapRpc(last);
}

async function withClient<T>(creds: Creds, work: (opened: Opened) => Promise<T>): Promise<T> {
  const opened = await openClient(creds);
  try {
    return await work(opened);
  } catch (err) {
    throw mapRpc(err);
  } finally {
    await closeClient(opened.client);
  }
}

function readMe(me: unknown): {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
} {
  const raw = me as {
    id?: number | string | { toString(): string };
    firstName?: string;
    lastName?: string | null;
    username?: string | null;
  };
  return {
    telegramUserId: Number(raw.id ?? 0),
    firstName: String(raw.firstName ?? "You"),
    lastName: raw.lastName ?? null,
    username: raw.username ?? null,
  };
}

function numericPeerId(peerId: string): bigint {
  const stripped = String(peerId).replace(/^-100/, "").replace(/^-/, "");
  try {
    return BigInt(stripped);
  } catch {
    return BigInt(0);
  }
}

function inputPeer(
  lib: Teleproto,
  opts: { peerId: string; accessHash?: string | null; peerKind?: TelegramPeerKind | null },
) {
  const kind = opts.peerKind ?? peerKindFromId(opts.peerId);
  const id = numericPeerId(opts.peerId);
  // teleproto constructors take gramjs BigInteger; native bigint is the runtime value.
  const chatId = id as never;
  if (kind === "chat") {
    return new lib.Api.InputPeerChat({ chatId });
  }
  const parsedHash = parseAccessHash(opts.accessHash ?? null);
  assertPrivatePeerHash(kind, parsedHash);
  const accessHash = BigInt(parsedHash as string) as never;
  if (kind === "channel") {
    return new lib.Api.InputPeerChannel({ channelId: chatId, accessHash });
  }
  return new lib.Api.InputPeerUser({ userId: chatId, accessHash });
}

function resolvePeerTarget(opts: {
  peerId: string;
  accessHash?: string | null;
  peerKind?: TelegramPeerKind | null;
  lib: Teleproto;
}): { entity: unknown; kind: TelegramPeerKind; accessHash: string | null } {
  const kind = opts.peerKind ?? peerKindFromId(opts.peerId);
  const accessHash = parseAccessHash(opts.accessHash ?? null);
  assertPrivatePeerHash(kind, accessHash);
  return { entity: inputPeer(opts.lib, { peerId: opts.peerId, accessHash, peerKind: kind }), kind, accessHash };
}

export async function sendLoginCode(opts: {
  apiId: number;
  apiHash: string;
  phone: string;
}): Promise<{ phoneCodeHash: string; session: string }> {
  return withClient(opts, async ({ client, save }) => {
    const sent = await withTimeout(
      client.sendCode({ apiId: opts.apiId, apiHash: opts.apiHash }, opts.phone),
      20_000,
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
  });
}

export async function signInWithCode(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  phone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<{
  needsPassword: boolean;
  session: string;
  me: ReturnType<typeof readMe> | null;
}> {
  return withClient(opts, async ({ lib, client, save }) => {
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
    } catch (err) {
      const mapped = mapRpc(err);
      if (mapped.code === "password" || /SESSION_PASSWORD_NEEDED/i.test(String(err))) {
        return { needsPassword: true, session: save(), me: null };
      }
      throw mapped;
    }
    const me = readMe(await withTimeout(client.getMe(), 12_000, "me"));
    return { needsPassword: false, session: save(), me };
  });
}

export async function signInCloudPassword(opts: {
  apiId: number;
  apiHash: string;
  session: string;
  password: string;
}): Promise<{ session: string; me: ReturnType<typeof readMe> }> {
  return withClient(opts, async ({ client, save }) => {
    await withTimeout(
      client.signInWithPassword(
        { apiId: opts.apiId, apiHash: opts.apiHash },
        {
          password: async () => opts.password,
          onError: async () => false,
        },
      ),
      20_000,
      "cloud password",
    );
    const me = readMe(await withTimeout(client.getMe(), 12_000, "me"));
    return { session: save(), me };
  });
}

export async function fetchMe(opts: Creds): Promise<{
  me: ReturnType<typeof readMe>;
  session: string;
}> {
  return withClient(opts, async ({ client, save }) => {
    const me = readMe(await withTimeout(client.getMe(), 12_000, "me"));
    return { me, session: save() };
  });
}

export type InboxDialog = {
  chatId: string;
  title: string;
  peerId: string;
  accessHash: string | null;
  peerKind: TelegramPeerKind;
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
  skipDialogs?: boolean;
  focusAccessHash?: string | null;
  focusPeerKind?: TelegramPeerKind | null;
}): Promise<{ dialogs: InboxDialog[]; histories: { chatId: string; messages: InboxMessage[] }[]; session: string }> {
  return withClient(opts, async ({ lib, client, save }) => {
    const dialogs: InboxDialog[] = [];
    const histories: { chatId: string; messages: InboxMessage[] }[] = [];
    if (!opts.skipDialogs) {
      const dialogsRaw = await withTimeout(
        client.getDialogs({ limit: opts.dialogLimit ?? 40 }),
        18_000,
        "dialogs",
      );
      const list = await asList(dialogsRaw);
      for (const d of list) {
        const entity = (d as {
          entity?: {
            id?: number | string;
            className?: string;
            title?: string;
            firstName?: string;
            username?: string;
            accessHash?: number | string;
            access_hash?: number | string;
          };
        }).entity;
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
        const hash = entity?.accessHash ?? entity?.access_hash ?? null;
        const peerKind = peerKindFromEntity(entity, id);
        dialogs.push({
          chatId: id,
          title,
          peerId: id,
          accessHash: hash == null ? null : String(hash),
          peerKind,
          unread,
          pinned,
          muted: Boolean((d as { muted?: boolean }).muted),
          lastPreview: message?.message?.slice(0, 140) ?? null,
          lastAt: message?.date ? new Date(message.date * 1000).toISOString() : null,
        });
      }
    }

    const focus = opts.focusChatId ? String(opts.focusChatId).replace(/^.*_/, "") : null;
    const targets = focus
      ? (dialogs.filter((d) => d.chatId === focus || d.peerId === focus).length
          ? dialogs.filter((d) => d.chatId === focus || d.peerId === focus)
          : [
              {
                chatId: focus,
                peerId: focus,
                title: "Chat",
                accessHash: opts.focusAccessHash ?? null,
                peerKind: opts.focusPeerKind ?? peerKindFromId(focus),
              } as InboxDialog,
            ])
      : dialogs.slice(0, Math.max(0, opts.historyChats ?? 1));

    for (const t of targets) {
      if (!t.peerId) continue;
      try {
        const kind = t.peerKind ?? peerKindFromId(t.peerId);
        const resolved = resolvePeerTarget({
          lib,
          peerId: t.peerId,
          accessHash: t.accessHash ?? opts.focusAccessHash ?? null,
          peerKind: kind,
        });
        const msgs = await withTimeout(
          client.getMessages(resolved.entity as never, { limit: opts.historyLimit ?? 40 }),
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
        const kind = historyFailureKind(err);
        if (!isCollapsedHistoryMiss(kind)) throw mapRpc(err);
        console.info("[telegram]", {
          event: kind === "need_hash" ? "history_need_hash" : "history_miss",
          chatId: t.chatId,
        });
      }
    }
    return { dialogs, histories, session: save() };
  });
}

export async function sendAsUser(opts: Creds & {
  peerId: string;
  body: string;
  accessHash?: string | null;
  peerKind?: TelegramPeerKind | null;
}): Promise<{ session: string; telegramMessageId: number }> {
  return withClient(opts, async ({ lib, client, save }) => {
    const resolved = resolvePeerTarget({
      lib,
      peerId: opts.peerId,
      accessHash: opts.accessHash ?? null,
      peerKind: opts.peerKind ?? peerKindFromId(opts.peerId),
    });
    const sent = await withTimeout(
      client.sendMessage(resolved.entity as never, { message: opts.body }),
      15_000,
      "send",
    );
    const id = Number((sent as { id?: number }).id ?? 0);
    return { session: save(), telegramMessageId: id };
  });
}

export async function revokeSession(opts: Creds): Promise<void> {
  return withClient(opts, async ({ lib, client }) => {
    await withTimeout(client.invoke(new lib.Api.auth.LogOut()), 10_000, "logout");
  });
}
