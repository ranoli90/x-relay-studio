import { decodeAmp } from "./html";
import { refreshAccessToken } from "./oauth";
import { userAgentFor } from "./types";

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
  ) {
    super(message);
    this.name = "RedditApiError";
  }
}

export async function oauthGet<T>(opts: {
  accessToken: string;
  userAgent: string;
  path: string;
}): Promise<{ data: T; remaining: number | null; reset: number | null }> {
  const url = opts.path.startsWith("http")
    ? opts.path
    : `https://oauth.reddit.com${opts.path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "User-Agent": opts.userAgent,
      Accept: "application/json",
    },
  });
  const remaining = headerInt(res.headers.get("x-ratelimit-remaining"));
  const reset = headerInt(res.headers.get("x-ratelimit-reset"));
  const text = await res.text();
  if (res.status === 429) {
    throw new RedditApiError(
      429,
      "RATELIMIT",
      `Reddit asked us to wait ${reset ?? "a moment"}s.`,
    );
  }
  if (!res.ok) {
    throw new RedditApiError(
      res.status,
      res.status === 401 ? "UNAUTHORIZED" : "HTTP",
      text.slice(0, 240) || `Reddit returned ${res.status}`,
    );
  }
  return { data: JSON.parse(text) as T, remaining, reset };
}

function headerInt(v: string | null) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: Date | null;
}): Promise<{ accessToken: string; expiresAt: Date; refreshed: boolean }> {
  const ua = userAgentFor(opts.userAgentName);
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
  };
}
