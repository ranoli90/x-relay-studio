/** Truthful MTProto client identity + FLOOD_WAIT / DC-connect parsing. */

export type MtprotoTransport = "tcp" | "wss";

function envFlag(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

export function floodWaitSeconds(raw: string): number | null {
  const match = raw.match(/(?:FLOOD_WAIT|SLOWMODE_WAIT)[_:]?(\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

/** GramJS/teleproto surfaces this when a DC handshake dies before RPC. */
export function isDcConnectFailure(raw: string): boolean {
  return /failed to connect to dc\s*\d+/i.test(raw);
}

export function isAuthKeyDuplicated(raw: string): boolean {
  return /AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|AUTH_KEY_PERM_EMPTY/i.test(
    raw,
  );
}

export function isPeerFlood(raw: string): boolean {
  return /PEER_FLOOD|USER_BANNED_IN_CHANNEL/i.test(raw);
}

export function isAccountFrozen(raw: string): boolean {
  return /USER_DEACTIVATED_BAN|USER_DEACTIVATED|FROZEN_METHOD_INVALID|INPUT_USER_DEACTIVATED/i.test(
    raw,
  );
}

/**
 * Pin a stable unofficial Web fingerprint.
 * Never embed process.version — Telegram treats a Node bump as a new client
 * on the same auth key and freezes the account.
 */
export function mtprotoClientOpts(transport: MtprotoTransport = "tcp") {
  const forceWss = envFlag("TELEGRAM_MTPROTO_WSS") === "true";
  const useWSS = forceWss || transport === "wss";
  return {
    connectionRetries: 2,
    requestRetries: 1,
    timeout: 12,
    autoReconnect: false,
    retryDelay: 800,
    useWSS,
    useIPV6: false,
    deviceModel: envFlag("TELEGRAM_DEVICE_MODEL") || "X Relay Studio",
    systemVersion: envFlag("TELEGRAM_SYSTEM_VERSION") || "X Relay Studio",
    appVersion: envFlag("TELEGRAM_APP_VERSION") || "0.1.0",
    langCode: "en",
    systemLangCode: "en-US",
  };
}
