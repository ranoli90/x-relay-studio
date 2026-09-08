/** Visibility-aware unread. Fetching a list or opening a cache is not an ack. */

export type ReadAckInput = {
  conversationVisible: boolean;
  documentVisible: boolean;
  chatListOnly: boolean;
  explicitAck: boolean;
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

export function applyReadAck(unread: number, ack: ReadAckInput): number {
  return shouldMarkRead(ack) ? 0 : unread;
}
