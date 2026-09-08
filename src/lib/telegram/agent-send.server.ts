/** Agent Telegram send. Jobs must call this — never telegramSendFn. */
import { isServicePeer } from "./preview.ts";
import {
  parseAccessHash,
  peerKindFromId,
  peerNeedsAccessHash,
  type TelegramPeerKind,
} from "./peer.ts";
import { TelegramError } from "./errors.ts";
import { preSendFence } from "../conversation/mirror.ts";

export type AgentSendResult =
  | { ok: true; status: "sent"; telegramMessageId?: number }
  | { ok: false; reason: string };

export type AgentSendPath = "live" | "not_live";

export type AgentSendGateInput = {
  account: { preview: boolean } | null;
  session: { session_enc?: string | null; auth_dead?: boolean | null } | null;
  peerId: string | null | undefined;
  peerKind?: TelegramPeerKind | null;
  accessHash?: string | null;
  chatKind?: "notes" | "bot" | "user" | null;
};

/**
 * Preview / unlinked / dead session / service peer / missing private hash
 * stay desk-local. Live MTProto only when the session can actually send.
 */
export function decideAgentSendPath(input: AgentSendGateInput): AgentSendPath {
  if (!input.account || input.account.preview) return "not_live";
  if (!input.session?.session_enc || input.session.auth_dead) return "not_live";
  if (!input.peerId) return "not_live";
  if (isServicePeer(input.peerId)) return "not_live";
  if (input.chatKind && input.chatKind !== "user") return "not_live";
  const kind = input.peerKind ?? peerKindFromId(input.peerId);
  if (peerNeedsAccessHash(kind) && !parseAccessHash(input.accessHash)) return "not_live";
  return "live";
}

type ResolvedChat = {
  id: string;
  kind: "notes" | "bot" | "user";
  peerId: string | null;
  accessHash: string | null;
  peerKind: TelegramPeerKind | null;
};

async function resolveChat(
  userId: string,
  chatId?: string | null,
  peerId?: string | null,
): Promise<ResolvedChat | null> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const a = chatId?.trim() || null;
  const b = peerId?.trim() || null;
  if (!a && !b) return null;

  const map = (row: {
    id: string;
    kind: "notes" | "bot" | "user";
    peer_id: string | null;
    access_hash?: string | null;
    peer_kind?: string | null;
  }): ResolvedChat => {
    const peerKind: TelegramPeerKind | null =
      row.peer_kind === "user" || row.peer_kind === "chat" || row.peer_kind === "channel"
        ? row.peer_kind
        : row.peer_id
          ? peerKindFromId(row.peer_id)
          : null;
    return {
      id: row.id,
      kind: row.kind,
      peerId: row.peer_id,
      accessHash: parseAccessHash(row.access_hash ?? null),
      peerKind,
    };
  };

  try {
    const rows = await sql.query<{
      id: string;
      kind: "notes" | "bot" | "user";
      peer_id: string | null;
      access_hash: string | null;
      peer_kind: string | null;
    }>(
      `select id, kind, peer_id, access_hash, peer_kind
         from telegram_chats
        where user_id = $1
          and (
            ($2::text is not null and (id = $2 or peer_id = $2))
            or ($3::text is not null and (id = $3 or peer_id = $3))
          )
        limit 1`,
      [userId, a, b],
    );
    return rows[0] ? map(rows[0]) : null;
  } catch {
    const rows = await sql.query<{
      id: string;
      kind: "notes" | "bot" | "user";
      peer_id: string | null;
    }>(
      `select id, kind, peer_id
         from telegram_chats
        where user_id = $1
          and (
            ($2::text is not null and (id = $2 or peer_id = $2))
            or ($3::text is not null and (id = $3 or peer_id = $3))
          )
        limit 1`,
      [userId, a, b],
    );
    return rows[0] ? map(rows[0]) : null;
  }
}

async function commitLocal(opts: {
  userId: string;
  chatId: string;
  body: string;
  authorName: string;
  telegramMessageId?: number;
}): Promise<void> {
  const { appendMessage } = await import("./snapshot.server");
  await appendMessage({
    userId: opts.userId,
    chatId: opts.chatId,
    fromSelf: true,
    authorName: opts.authorName,
    body: opts.body,
    telegramMessageId: opts.telegramMessageId,
    aiStatus: "outbound",
  });
}

function failReason(err: unknown, fallback: string): string {
  if (err instanceof TelegramError) return err.code;
  return fallback;
}

export async function agentSendToPeer(opts: {
  userId: string;
  chatId?: string | null;
  peerId?: string | null;
  body: string;
  agentName?: string;
  threadId?: string;
  accountGeneration?: number;
  consentEpoch?: number;
  takeover?: boolean;
  optOut?: boolean;
  emergencyStop?: boolean;
}): Promise<AgentSendResult> {
  const body = opts.body.trim();
  if (!body) return { ok: false, reason: "empty" };
  if (body.length > 4000) return { ok: false, reason: "too_long" };

  const fence = preSendFence(opts);
  if (!fence.allow) return { ok: false, reason: fence.reason };

  const { loadLiveFinalState } = await import("@/lib/operator/persist.server");
  const { revalidateForSend } = await import("@/lib/operator/state");
  const captured = await loadLiveFinalState(opts.userId, opts.threadId);
  if (captured.emergencyStop) return { ok: false, reason: "emergency_stop" };
  if (captured.takeover) return { ok: false, reason: "takeover" };
  if (captured.optOut) return { ok: false, reason: "opt_out" };
  if (!captured.processingPermission) return { ok: false, reason: "permission_revoked" };
  if (!captured.conversationPermitted) return { ok: false, reason: "not_permitted" };
  if (!captured.accountLive) return { ok: false, reason: "not_live" };

  const chat = await resolveChat(opts.userId, opts.chatId, opts.peerId);
  if (!chat) return { ok: false, reason: "chat_not_found" };

  const { getAccount } = await import("./snapshot.server");
  const { getUserSession } = await import("./session.server");
  const account = await getAccount(opts.userId);
  const session = await getUserSession(opts.userId);
  const authorName = opts.agentName?.trim() || account?.displayName || "Agent";

  const path = decideAgentSendPath({
    account,
    session,
    peerId: chat.peerId,
    peerKind: chat.peerKind,
    accessHash: chat.accessHash,
    chatKind: chat.kind,
  });

  if (path === "not_live") {
    return { ok: false, reason: "not_live" };
  }

  const { assertSessionLive, decryptSessionMaterial, saveSignedIn, persistMappedError } =
    await import("./session.server");
  const { assertPrivatePeerHash } = await import("./peer");
  const sendKind = chat.peerKind ?? (chat.peerId ? peerKindFromId(chat.peerId) : "user");

  let live;
  try {
    live = assertSessionLive(session);
    assertPrivatePeerHash(sendKind, chat.accessHash);
  } catch (err) {
    if (err instanceof TelegramError && err.code === "flood") {
      return { ok: false, reason: "flood" };
    }
    return { ok: false, reason: "not_live" };
  }

  const peerId = chat.peerId!;
  const material = await decryptSessionMaterial(live);
  const generation = Number(live.account_generation) || 1;

  const { beginSendIntent, completeSendIntent, failSendIntent, sendOutcomeFromError } =
    await import("./send-intent.server");
  const { takeUserSend } = await import("./rate.server");
  const { withMtprotoLease } = await import("./lease.server");
  const { sendAsUser } = await import("./mtproto.server");
  const { findRecentOutbound } = await import("./snapshot.server");

  let intentId: string;
  try {
    const started = await beginSendIntent({
      userId: opts.userId,
      chatId: chat.id,
      peerId,
      body,
    });
    if (started.reuse?.status === "sent") {
      const existing = await findRecentOutbound(
        opts.userId,
        chat.id,
        body,
        started.reuse.telegramMessageId,
      );
      if (!existing) {
        const reusedId = started.reuse.telegramMessageId
          ? Number(started.reuse.telegramMessageId)
          : undefined;
        await commitLocal({
          userId: opts.userId,
          chatId: chat.id,
          body,
          authorName,
          telegramMessageId: Number.isFinite(reusedId) ? reusedId : undefined,
        });
      }
      const reused = started.reuse.telegramMessageId
        ? Number(started.reuse.telegramMessageId)
        : undefined;
      return {
        ok: true,
        status: "sent",
        telegramMessageId: Number.isFinite(reused) ? reused : undefined,
      };
    }
    intentId = started.intentId;
  } catch (err) {
    return { ok: false, reason: failReason(err, "flood") };
  }

  try {
    await takeUserSend(opts.userId);
  } catch (err) {
    await failSendIntent(
      intentId,
      opts.userId,
      "failed",
      err instanceof Error ? err.message : "send rate limited",
    );
    return { ok: false, reason: failReason(err, "flood") };
  }

  const fenceLive = preSendFence(opts);
  if (!fenceLive.allow) {
    await failSendIntent(intentId, opts.userId, "failed", fenceLive.reason);
    return { ok: false, reason: fenceLive.reason };
  }

  const liveBeforeLease = await loadLiveFinalState(opts.userId, opts.threadId);
  const preLease = revalidateForSend(captured, liveBeforeLease);
  if (!preLease.allow) {
    await failSendIntent(intentId, opts.userId, "failed", preLease.reason);
    return { ok: false, reason: preLease.reason };
  }

  try {
    const sent = await withMtprotoLease(opts.userId, async () => {
      const live = await loadLiveFinalState(opts.userId, opts.threadId);
      const check = revalidateForSend(captured, live);
      if (!check.allow) {
        throw Object.assign(new Error(check.reason), { code: "stale_fence", reason: check.reason });
      }
      const result = await sendAsUser({
        apiId: material.apiId,
        apiHash: material.apiHash,
        session: material.session,
        peerId,
        accessHash: chat.accessHash,
        peerKind: sendKind,
        body,
      });
      await completeSendIntent(intentId, opts.userId, result.telegramMessageId);
      if (result.session !== material.session) {
        await saveSignedIn({ userId: opts.userId, session: result.session, generation });
      }
      return result;
    });
    await commitLocal({
      userId: opts.userId,
      chatId: chat.id,
      body,
      authorName,
      telegramMessageId: sent.telegramMessageId,
    });
    return { ok: true, status: "sent", telegramMessageId: sent.telegramMessageId };
  } catch (err) {
    const stale = err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "stale_fence";
    if (stale) {
      const reason = (err as { reason?: string }).reason ?? "stale_fence";
      await failSendIntent(intentId, opts.userId, "failed", reason);
      return { ok: false, reason };
    }
    const outcome = sendOutcomeFromError(err);
    await failSendIntent(
      intentId,
      opts.userId,
      outcome,
      err instanceof Error ? err.message : "send failed",
    );
    await persistMappedError(opts.userId, err);
    if (outcome === "uncertain") return { ok: false, reason: "uncertain" };
    return { ok: false, reason: failReason(err, "failed") };
  }
}
