/** Visibility-aware unread. Fetching a list or opening a cache is not an ack. */

export type ReadAckInput = {
  conversationVisible: boolean;
  documentVisible: boolean;
  chatListOnly: boolean;
  explicitAck: boolean;
  lastSeenMessageId?: string | null;
};

export function shouldMarkRead(input: ReadAckInput): boolean {
  if (!input.explicitAck) return false;
  if (input.chatListOnly) return false;
  if (!input.documentVisible) return false;
  if (!input.conversationVisible) return false;
  return true;
}

export function unreadAfterInbound(current: number, inboundCount: number): number {
  const n = Math.max(0, Math.floor(current));
  const add = Math.max(0, Math.floor(inboundCount));
  return n + add;
}

/**
 * Ack the last rendered inbound id. Messages that arrived after that id stay
 * unread. Visibility without a last-seen id does not clear the badge.
 */
export function applyReadAck(
  unread: number,
  ack: ReadAckInput,
  inboundAfterLastSeen = 0,
): number {
  if (!shouldMarkRead(ack)) return unread;
  if (!ack.lastSeenMessageId) return unread;
  return Math.max(0, Math.floor(inboundAfterLastSeen));
}
