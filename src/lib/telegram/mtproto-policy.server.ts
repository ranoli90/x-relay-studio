/** Truthful MTProto client identity + FLOOD_WAIT parsing. */

export function mtprotoClientOpts() {
  const node = process.version.replace(/^v/, "Node ");
  return {
    connectionRetries: 0,
    timeout: 8,
    autoReconnect: false,
    retryDelay: 0,
    useWSS: true,
    deviceModel: process.env.TELEGRAM_DEVICE_MODEL?.trim() || "X Relay Studio",
    systemVersion: process.env.TELEGRAM_SYSTEM_VERSION?.trim() || node,
    appVersion: process.env.TELEGRAM_APP_VERSION?.trim() || "0.1.0",
    langCode: "en",
    systemLangCode: "en-US",
  };
}

export function floodWaitSeconds(raw: string): number | null {
  const match = raw.match(/FLOOD_WAIT[_:]?(\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}
