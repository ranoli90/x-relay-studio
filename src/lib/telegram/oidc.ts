import { createHash, randomBytes } from "node:crypto";
import * as jose from "jose";
import { TelegramError } from "./errors";
import type { TelegramOidcConfig } from "./config.server";

const AUTH_URL = "https://oauth.telegram.org/auth";
const TOKEN_URL = "https://oauth.telegram.org/token";
const JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json";
const ISSUER = "https://oauth.telegram.org";
const LOGIN_MAX_AGE_SEC = 5 * 60;

const jwks = jose.createRemoteJWKSet(new URL(JWKS_URL));

export type OidcStart = {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
};

export type TelegramOidcProfile = {
  telegramUserId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  botCanWrite: boolean;
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

  if (typeof payload.nonce === "string" && payload.nonce !== opts.nonce) {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const iat = typeof payload.iat === "number" ? payload.iat : now;
  const authDate =
    typeof payload.auth_date === "number"
      ? payload.auth_date
      : typeof payload.auth_date === "string"
        ? Number(payload.auth_date)
        : iat;
  if (now - authDate > LOGIN_MAX_AGE_SEC || now - iat > LOGIN_MAX_AGE_SEC) {
    throw new TelegramError("telegram_login_expired", "Telegram login expired.", 401);
  }

  const idRaw = payload.id ?? payload.sub;
  const telegramUserId = Number(idRaw);
  if (!Number.isFinite(telegramUserId) || telegramUserId <= 0) {
    throw new TelegramError("invalid", "Telegram identity was incomplete.", 400);
  }

  const given = typeof payload.given_name === "string" ? payload.given_name : "";
  const name = typeof payload.name === "string" ? payload.name : "";
  const firstName = given || name.split(" ")[0] || "Telegram";
  const lastName =
    typeof payload.family_name === "string"
      ? payload.family_name
      : name.includes(" ")
        ? name.split(" ").slice(1).join(" ")
        : null;
  const username =
    typeof payload.preferred_username === "string"
      ? payload.preferred_username.replace(/^@/, "")
      : null;
  const photoUrl = typeof payload.picture === "string" ? payload.picture : null;

  return {
    telegramUserId,
    firstName,
    lastName: lastName || null,
    username,
    photoUrl,
    botCanWrite: false,
  };
}
