/** Exact values for my.telegram.org → Create new application. Client-safe. */

export const TELEGRAM_APP_FORM = {
  title: "X Relay",
  shortName: "xrelay",
  platform: "Web",
  description:
    "Third-party desk that watches and sends as your own Telegram account. Not the official Telegram app.",
  portal: "https://my.telegram.org",
  toolsPath: "https://my.telegram.org/apps",
} as const;

const UNSAFE_PLATFORMS = new Set([
  "android",
  "ios",
  "windows phone",
  "blackberry",
  "desktop",
  "ubuntu phone",
]);

export function appFormUrl(origin?: string): string {
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      /* ignore */
    }
  }
  return "https://x-relay-studio-puce.vercel.app";
}

export function isUnsafePlatform(value: string): boolean {
  return UNSAFE_PLATFORMS.has(value.trim().toLowerCase());
}

export function titleLooksOfficial(title: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return false;
  if (t === "telegram") return true;
  if (t.startsWith("telegram ")) return true;
  return /\btelegram\b/.test(t) && !t.startsWith("unofficial");
}
