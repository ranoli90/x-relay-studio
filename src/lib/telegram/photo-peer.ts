/** Query-string peer ids for GET /api/telegram/photo. Numeric Telegram ids only. */

const PEER_RE = /^[0-9-]+$/;
const MAX_PEER_LEN = 40;

export function parsePhotoPeer(raw: string | null | undefined): string | null {
  const peer = raw?.trim() ?? "";
  if (!peer || peer.length > MAX_PEER_LEN || !PEER_RE.test(peer)) return null;
  if (peer === "-" || peer === "0" || /^-0+$/.test(peer)) return null;
  return peer;
}
