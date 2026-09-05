# X Relay Studio

Anonymous 16-digit desk. Connect X, Telegram, or Reddit. Rewrite and drip with OpenRouter.

This is an independent product. It is not affiliated with X Corp, Telegram FZ-LLC, or Reddit Inc.

## Production checklist

- `DATABASE_URL` — Neon pooled Postgres. Production refuses to boot on PGLite.
- `BETTER_AUTH_SECRET` — 32+ bytes. Sessions and AES-GCM envelopes.
- `BETTER_AUTH_URL` — public origin. Used for OAuth redirects and cookies.
- `OPENROUTER_API_KEY` — rewrites fail closed without it.
- `CRON_SECRET` — `Authorization: Bearer` on `/api/cron/studio`.
- `SECRETS_ENCRYPTION_KEY` — optional dedicated envelope key.
- `ALLOWED_ORIGINS` — extra Reddit OAuth origins.
- `FXTWITTER_ENABLED` — unofficial public X lookup. Set `false` to disable.
- `TELEGRAM_MTPROTO_ENABLED` — set `false` to disable the user client.

Run `npm run db:migrate` against Neon **before** the first production request. The build no longer migrates.

## Scripts

```bash
npm test
npm run check:migrations
npm run typecheck
npm run build
```

## Platform rules we follow

- Reddit: OAuth2 `authorization_code` + `duration=permanent`, `oauth.reddit.com` only, unique User-Agent, honor `x-ratelimit-*`.
- Telegram: your `api_id` / `api_hash`, truthful device string (`X Relay Studio` / Node), honor `FLOOD_WAIT_N`, header-only webhook secret.
- X source lookup via FXTwitter is unofficial and gated.

See [SECURITY.md](SECURITY.md), [/privacy](/privacy), and [/terms](/terms).
