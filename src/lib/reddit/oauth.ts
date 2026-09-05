import { REDDIT_SCOPES } from "./types";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REVOKE_URL = "https://www.reddit.com/api/v1/revoke_token";
const TOKEN_TIMEOUT_MS = 15_000;

export function authorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("https://www.reddit.com/api/v1/authorize");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("duration", "permanent");
  url.searchParams.set("scope", REDDIT_SCOPES);
  return url.toString();
}

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
};

async function tokenRequest(opts: {
  clientId: string;
  clientSecret: string;
  userAgent: string;
  body: URLSearchParams;
}): Promise<TokenResponse> {
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": opts.userAgent,
      Accept: "application/json",
    },
    body: opts.body,
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { error: text.slice(0, 200) };
  }
  if (!res.ok || json.error) {
    const err = String(json.error || res.status);
    const desc = json.error_description ? String(json.error_description) : "";
    throw new RedditOAuthError(err, desc, res.status);
  }
  if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") {
    throw new RedditOAuthError("BAD_TOKEN", "Reddit returned an incomplete token payload.", res.status);
  }
  return json as unknown as TokenResponse;
}

export class RedditOAuthError extends Error {
  code: string;
  description: string;
  status: number;
  constructor(code: string, description: string, status: number) {
    super(description ? `${code}: ${description}` : code);
    this.name = "RedditOAuthError";
    this.code = code;
    this.description = description;
    this.status = status;
  }
}

export function exchangeCode(opts: {
  clientId: string;
  clientSecret: string;
  userAgent: string;
  code: string;
  redirectUri: string;
}) {
  return tokenRequest({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    userAgent: opts.userAgent,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
}

export function refreshAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  userAgent: string;
  refreshToken: string;
}) {
  return tokenRequest({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    userAgent: opts.userAgent,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
    }),
  });
}

export function clientCredentials(opts: {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}) {
  return tokenRequest({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    userAgent: opts.userAgent,
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
}

export async function revokeToken(opts: {
  clientId: string;
  clientSecret: string;
  userAgent: string;
  token: string;
}) {
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
  const res = await fetch(REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": opts.userAgent,
    },
    body: new URLSearchParams({
      token: opts.token,
      token_type_hint: "refresh_token",
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new RedditOAuthError("REVOKE_FAILED", `Reddit returned HTTP ${res.status}.`, res.status);
  }
  return { ok: true as const, status: res.status };
}
