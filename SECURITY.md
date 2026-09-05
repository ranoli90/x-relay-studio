# Security

X Relay Studio is an anonymous desk: a 16-digit number is the only account. X, Telegram, and Reddit attach to that desk. Treat the number like a password.

## Secrets that must never ship in git

- `OPENROUTER_API_KEY`
- `BETTER_AUTH_SECRET` / `SECRETS_ENCRYPTION_KEY`
- `CRON_SECRET`
- `DATABASE_URL`
- Per-desk Reddit client secrets and OAuth refresh tokens
- Per-desk Telegram `api_hash` and MTProto session strings

A leaked OpenRouter key in source is a P0. The server now fails closed if the env key is missing. Rotate any key that ever lived in a commit.

## Authn / authz

- Desk restore signs in as `d{16digits}@example.com` with the number as the password. Do not change that mapping.
- `openDesk({ restore: true })` never mints a new number on clash. It throws.
- Telegram photo proxy requires a real session. `VITE_AUTH_ENABLED=false` is not a bypass.
- Cron requires `Authorization: Bearer $CRON_SECRET`. The `x-vercel-cron` header is not trusted.
- Reddit OAuth origins come from `BETTER_AUTH_URL` + `ALLOWED_ORIGINS`. `x-forwarded-host` is not an allowlist.

## Tokens at rest

Reddit client secrets, access tokens, and refresh tokens are AES-256-GCM envelopes (`v1.iv.tag.ct`) keyed by HKDF-SHA256 of `SECRETS_ENCRYPTION_KEY` or `BETTER_AUTH_SECRET`. Legacy plaintext rows still decrypt as-is and are rewritten on the next save.

Telegram helper keys already use the same class of envelope in `src/lib/telegram/crypto.server.ts`.

## Platform rules

- Reddit: official OAuth2 only, `duration=permanent`, read-only scopes, unique app names without the Reddit trademark, no HTML scrape of reddit.com.
- Telegram: user-owned api_id/api_hash from my.telegram.org as a Web app. Do not impersonate official desktop fingerprints. Webhook secret is a header, never a query string. Postgres stores SHA-256 of that token. 429 must not ACK the update.
- X rewrite path: OpenRouter only. Unofficial FXTwitter/syndication scrapers stay behind an explicit feature flag and are off by default.

## Reporting

Open a private GitHub security advisory on this repo, or email the operator who owns `ranoli90`. Do not file public issues that include tokens, session strings, or desk numbers.
