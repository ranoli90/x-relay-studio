/** Client-safe token shape helpers. Never store or log the raw key. */

const TOKEN_RE = /^(\d{5,}):([A-Za-z0-9_-]{30,})$/;

export function parseBotToken(raw: string): { botId: number; token: string } | null {
  const token = raw.trim();
  const match = TOKEN_RE.exec(token);
  if (!match) return null;
  const botId = Number(match[1]);
  if (!Number.isSafeInteger(botId) || botId <= 0) return null;
  return { botId, token };
}

export function maskBotToken(token: string): string {
  const parsed = parseBotToken(token);
  if (!parsed) return "••••";
  const secret = token.slice(token.indexOf(":") + 1);
  const tail = secret.slice(-4);
  return `${parsed.botId}:••••${tail}`;
}

export function helloDeepLink(username: string | null, payload: string | null): string | null {
  if (!username || !payload) return null;
  return `https://t.me/${username}?start=${encodeURIComponent(payload)}`;
}

export function parseStartPayload(text: string): string | null {
  const match = text.trim().match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]+))?$/);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

export function notesChatId(userId: string): string {
  return `notes_${userId}`;
}

export function helperChatId(userId: string): string {
  return `helper_${userId}`;
}
