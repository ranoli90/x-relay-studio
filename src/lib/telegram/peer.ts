/** Private user/channel peers need a stored access hash on cold start. */

import { TelegramError } from "./errors.ts";

export type TelegramPeerKind = "user" | "chat" | "channel";

export function peerKindFromEntity(
  entity: { className?: string } | null | undefined,
  fallbackId: string,
): TelegramPeerKind {
  const name = String(entity?.className ?? "");
  if (/Channel/i.test(name)) return "channel";
  if (/Chat/i.test(name) && !/User/i.test(name)) return "chat";
  if (/User/i.test(name)) return "user";
  return peerKindFromId(fallbackId);
}

export function peerKindFromId(peerId: string): TelegramPeerKind {
  const id = String(peerId ?? "").trim();
  if (id.startsWith("-100")) return "channel";
  if (id.startsWith("-")) return "chat";
  return "user";
}

export function peerNeedsAccessHash(kind: TelegramPeerKind): boolean {
  return kind === "user" || kind === "channel";
}

export function parseAccessHash(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value || value === "0") return null;
  return value;
}

export function assertPrivatePeerHash(
  kind: TelegramPeerKind,
  accessHash: string | null | undefined,
): void {
  if (peerNeedsAccessHash(kind) && !parseAccessHash(accessHash)) {
    throw new TelegramError(
      "invalid",
      "This private chat needs a refresh before we can open it.",
      400,
    );
  }
}

export type HistoryFailureKind = "flood" | "revoked" | "dead" | "need_hash" | "miss";

export function historyFailureKind(err: unknown): HistoryFailureKind {
  if (err instanceof TelegramError) {
    if (err.code === "flood" || err.code === "peer_flood") return "flood";
    if (err.code === "auth_dead" || err.code === "unlinked") {
      return /revok/i.test(err.message) ? "revoked" : "dead";
    }
    if (err.code === "invalid") return "need_hash";
  }
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toUpperCase();
  if (
    msg.includes("PEER_ID_INVALID") ||
    msg.includes("CHAT_ID_INVALID") ||
    msg.includes("CHANNEL_INVALID") ||
    msg.includes("CHANNEL_PRIVATE") ||
    msg.includes("USER_ID_INVALID") ||
    msg.includes("USERNAME_NOT_OCCUPIED")
  ) {
    return "need_hash";
  }
  if (msg.includes("SESSION_REVOKED") || msg.includes("SESSION_EXPIRED")) return "revoked";
  if (
    msg.includes("AUTH_KEY") ||
    msg.includes("USER_DEACTIVATED") ||
    msg.includes("FROZEN_METHOD_INVALID")
  ) {
    return "dead";
  }
  if (
    msg.includes("FLOOD") ||
    msg.includes("PEER_FLOOD") ||
    msg.includes("SLOWMODE") ||
    (msg.includes("WAIT") && msg.includes("SECOND"))
  ) {
    return "flood";
  }
  return "miss";
}

export function isCollapsedHistoryMiss(kind: HistoryFailureKind): boolean {
  return kind === "miss" || kind === "need_hash";
}
