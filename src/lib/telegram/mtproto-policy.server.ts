/** Truthful MTProto client identity + FLOOD_WAIT / DC-connect parsing. */

export type MtprotoTransport = "tcp" | "wss";

function envFlag(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

export function floodWaitSeconds(raw: string): number | null {
  const match = raw.match(/FLOOD_WAIT[_:]?(\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

/** GramJS/teleproto surfaces this when a DC handshake dies before RPC. */
export function isDcConnectFailure(raw: string): boolean {
  return /failed to connect to dc\s*\d+/i.test(raw);
}

export function mtprotoClientOpts(transport: MtprotoTransport = "tcp") {
  const node = process.version.replace(/^v/, "Node ");
  const forceWss = envFlag("TELEGRAM_MTPROTO_WSS") === "true";
  const useWSS = forceWss || transport === "wss";
  return {
    connectionRetries: 3,
    requestRetries: 3,
    timeout: 12,
    autoReconnect: false,
    retryDelay: 800,
    useWSS,
    useIPV6: false,
    deviceModel: envFlag("TELEGRAM_DEVICE_MODEL") || "X Relay Studio",
    systemVersion: envFlag("TELEGRAM_SYSTEM_VERSION") || node,
    appVersion: envFlag("TELEGRAM_APP_VERSION") || "0.1.0",
    langCode: "en",
    systemLangCode: "en-US",
  };
}
