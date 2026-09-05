/** Watching/import is not consent to model a private message. */

const LOGIN_CODE = /\b(login code|login codes|security code|verification code|2fa)\b/i;
const SERVICE_CHAT = /^(telegram|telegram service notifications|service notifications)$/i;
const SERVICE_BODY =
  /^(joined the group|left the group|pinned a message|changed the group|created the group|scored \d+|invited)/i;

export function isNonProcessableInbound(body: string, authorName = ""): boolean {
  const text = body.trim();
  if (!text) return true;
  if (SERVICE_CHAT.test(authorName.trim())) return true;
  if (LOGIN_CODE.test(text)) return true;
  if (SERVICE_BODY.test(text)) return true;
  return false;
}

export function redactForModel(body: string): string {
  return body.replace(/\b\d{5,8}\b/g, "[code]");
}
