import { createHash, randomBytes } from "node:crypto";
import * as jose from "jose";
import { TelegramError } from "./errors";
import type { TelegramOidcConfig } from "./config.server";
import { assertOidcPayload, type TelegramOidcProfile } from "./oidc-claims";

export type { TelegramOidcProfile };

const AUTH_URL = "https://oauth.telegram.org/auth";
const TOKEN_URL = "https://oauth.telegram.org/token";
const JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json";
const ISSUER = "https://oauth.telegram.org";

const jwks = jose.createRemoteJWKSet(new URL(JWKS_URL));

export type OidcStart = {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
};

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function newOidcStart(cfg: TelegramOidcConfig, redirectUri: string): OidcStart {
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const { verifier, challenge } = createPkcePair();
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state, nonce, verifier };
}

export async function exchangeTelegramCode(opts: {
  cfg: TelegramOidcConfig;
  code: string;
  redirectUri: string;
  verifier: string;
  nonce: string;
}): Promise<TelegramOidcProfile> {
  const basic = Buffer.from(`${opts.cfg.clientId}:${opts.cfg.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.cfg.clientId,
    code_verifier: opts.verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.info("[telegram]", { event: "token_http", status: res.status });
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }

  let json: { id_token?: string };
  try {
    json = JSON.parse(raw) as { id_token?: string };
  } catch {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }
  if (!json.id_token) {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }

  const { payload } = await jose.jwtVerify(json.id_token, jwks, {
    issuer: ISSUER,
    audience: opts.cfg.clientId,
    clockTolerance: 30,
  });

  return assertOidcPayload(payload as Record<string, unknown>, opts.nonce);
}
