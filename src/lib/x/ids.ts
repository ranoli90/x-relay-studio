const BARE_TWEET_ID_RE = /^\d{6,20}$/;
const PATH_TWEET_ID_RE = /^\d{1,20}$/;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "mobile.x.com",
  "fxtwitter.com",
  "vxtwitter.com",
]);

const RESERVED = new Set([
  "i",
  "home",
  "search",
  "explore",
  "notifications",
  "messages",
  "settings",
  "compose",
  "hashtag",
  "status",
  "intent",
  "share",
  "login",
  "signup",
  "about",
]);

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    try {
      return new URL(`https://${input}`);
    } catch {
      return null;
    }
  }
}

export function extractTweetId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (BARE_TWEET_ID_RE.test(trimmed)) return trimmed;

  const url = parseUrl(trimmed);
  if (!url || !X_HOSTS.has(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const statusIdx = segments.indexOf("status");
  if (statusIdx === -1) return null;
  const id = segments[statusIdx + 1];
  return id !== undefined && PATH_TWEET_ID_RE.test(id) ? id : null;
}

export function looksLikeTweetRef(input: string): boolean {
  if (!input) return false;
  if (extractTweetId(input) !== null) return true;
  const url = parseUrl(input.trim());
  return url !== null && X_HOSTS.has(url.hostname) && input.includes("/status/");
}

export function extractHandle(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const bare = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (HANDLE_RE.test(bare)) return bare;

  const url = parseUrl(trimmed);
  if (!url || !X_HOSTS.has(url.hostname)) return null;

  const first = url.pathname.split("/").filter(Boolean)[0];
  if (first === undefined || RESERVED.has(first.toLowerCase())) return null;
  return HANDLE_RE.test(first) ? first : null;
}

export function looksLikeProfileRef(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("@") && extractHandle(trimmed)) return true;
  const url = parseUrl(trimmed);
  if (!url || !X_HOSTS.has(url.hostname)) return false;
  return extractHandle(trimmed) !== null && extractTweetId(trimmed) === null;
}

export type RelayIntent =
  | { kind: "thread"; id: string }
  | { kind: "profile"; handle: string }
  | { kind: "search"; query: string };

export function detectIntent(input: string): RelayIntent {
  const trimmed = input.trim();
  const tweetId = extractTweetId(trimmed);
  if (tweetId) return { kind: "thread", id: tweetId };
  if (looksLikeProfileRef(trimmed)) {
    const handle = extractHandle(trimmed);
    if (handle) return { kind: "profile", handle };
  }
  return { kind: "search", query: trimmed };
}
