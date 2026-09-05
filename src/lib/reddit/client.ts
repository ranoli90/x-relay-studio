import { decodeAmp } from "./html";
import { userAgentFor } from "./naming";
import { refreshAccessToken } from "./oauth";

export type RedditMe = {
  id: string;
  name: string;
  created_utc?: number;
  icon_img?: string;
  snoovatar_img?: string;
  link_karma?: number;
  comment_karma?: number;
  total_karma?: number;
  has_verified_email?: boolean;
  is_gold?: boolean;
  is_mod?: boolean;
  is_suspended?: boolean;
  verified?: boolean;
};

export class RedditApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "RedditApiError";
  }
}

const OAUTH_HOST = "oauth.reddit.com";

function assertOauthUrl(path: string): string {
  if (path.startsWith("http")) {
    const url = new URL(path);
    if (url.protocol !== "https:" || url.hostname !== OAUTH_HOST) {
      throw new RedditApiError(400, "BAD_HOST", "Reddit API calls must use oauth.reddit.com.");
    }
    return url.toString();
  }
  if (!path.startsWith("/")) {
    throw new RedditApiError(400, "BAD_PATH", "Reddit API path must be absolute.");
  }
  return `https://${OAUTH_HOST}${path}`;
}

function headerInt(v: string | null) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function waitSeconds(res: Response): number {
  const retryAfter = headerInt(res.headers.get("retry-after"));
  const reset = headerInt(res.headers.get("x-ratelimit-reset"));
  const raw = retryAfter ?? reset ?? 2;
  return Math.min(20, Math.max(1, raw));
}

function parseJson<T>(text: string, status: number): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RedditApiError(status, "BAD_JSON", text.slice(0, 240) || "Reddit returned invalid JSON");
  }
}

export async function oauthGet<T>(opts: {
  accessToken: string;
  userAgent: string;
  path: string;
}): Promise<{ data: T; remaining: number | null; reset: number | null }> {
  const url = assertOauthUrl(opts.path);
  const headers = {
    Authorization: `Bearer ${opts.accessToken}`,
    "User-Agent": opts.userAgent,
    Accept: "application/json",
  };

  const once = () =>
    fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

  let res = await once();
  if (res.status === 429) {
    const wait = waitSeconds(res);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    res = await once();
  }

  const remaining = headerInt(res.headers.get("x-ratelimit-remaining"));
  const reset = headerInt(res.headers.get("x-ratelimit-reset"));
  const text = await res.text();
  if (res.status === 429) {
    throw new RedditApiError(
      429,
      "RATELIMIT",
      `Reddit asked us to wait ${reset ?? "a moment"}s.`,
      waitSeconds(res),
    );
  }
  if (!res.ok) {
    throw new RedditApiError(
      res.status,
      res.status === 401 ? "UNAUTHORIZED" : "HTTP",
      text.slice(0, 240) || `Reddit returned ${res.status}`,
    );
  }
  return { data: parseJson<T>(text, res.status), remaining, reset };
}

export async function fetchMe(accessToken: string, userAgent: string) {
  const { data, remaining, reset } = await oauthGet<RedditMe>({
    accessToken,
    userAgent,
    path: "/api/v1/me",
  });
  return { me: data, remaining, reset };
}

export function iconFromMe(me: RedditMe) {
  const raw = decodeAmp(me.snoovatar_img || me.icon_img || "");
  return raw.split("?")[0] || null;
}

export async function ensureAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  userAgentName: string;
  appId: string;
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: Date | null;
}): Promise<{ accessToken: string; expiresAt: Date; refreshed: boolean; refreshToken?: string }> {
  const ua = userAgentFor(opts.userAgentName, opts.appId);
  const skewMs = 5 * 60 * 1000;
  if (
    opts.accessToken &&
    opts.accessExpiresAt &&
    opts.accessExpiresAt.getTime() - Date.now() > skewMs
  ) {
    return {
      accessToken: opts.accessToken,
      expiresAt: opts.accessExpiresAt,
      refreshed: false,
    };
  }
  const tok = await refreshAccessToken({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    userAgent: ua,
    refreshToken: opts.refreshToken,
  });
  return {
    accessToken: tok.access_token,
    expiresAt: new Date(Date.now() + tok.expires_in * 1000),
    refreshed: true,
    refreshToken: tok.refresh_token,
  };
}
