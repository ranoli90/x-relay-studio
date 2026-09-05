/** Keep login codes and other auth secrets out of chat previews and bodies. */
export function redactSecretText(raw: string): string {
  return raw
    .replace(/login code:\s*\d+/gi, "Login code")
    .replace(/\bcode:\s*\d{5,6}\b/gi, "code");
}

export function redactPreview(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = redactSecretText(raw).trim();
  return cleaned.slice(0, 140) || null;
}

export function mediaLabel(body: string): string {
  const value = body.trim().toLowerCase();
  if (value === "[media]") return "Photo";
  if (value === "[event]") return "Event";
  return body;
}

export function isServicePeer(peerId: string | null | undefined): boolean {
  return peerId === "777000" || peerId === "42777";
}
