# X Relay Studio

Anonymous desk for X, Telegram, and Reddit.

A 16-digit number is the only account. No name, no email, no Google, no X login. Connect platforms after the desk exists. The number is a key — if it is lost, the desk is gone.

## What this is

- **Desk** — Mullvad-style 16-digit identity stored in Better Auth as `d{number}@example.com`.
- **X** — sign in the posting account, assign public sources, sync archives, rewrite with OpenRouter.
- **Telegram** — the user's own `api_id` / `api_hash` from my.telegram.org (Web app), phone login code, optional cloud password. Official Bot API webhooks for helper bots. Not a userbot farm.
- **Reddit** — official OAuth2 (`authorization_code` + `duration=permanent`), read-only scopes, unique app names without the Reddit trademark, Data API signup first.

## Production requirements

Copy `.env.example` and set at least:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Neon. Production refuses to boot on PGLite. |
| `BETTER_AUTH_SECRET` | Sessions + AES-GCM envelopes for Reddit/Telegram secrets. |
| `BETTER_AUTH_URL` | Public origin. OAuth redirects and OpenRouter referer. |
| `OPENROUTER_API_KEY` | Rewrites. Fail-closed if missing. |
| `CRON_SECRET` | `Authorization: Bearer` on `/api/cron/studio`. |

Run migrations as a release step, not during `vite build`:

```
npm run db:migrate
```

## Local preview

```
npm install
cp .env.example .env.local
npm run dev
```

Without `DATABASE_URL`, preview uses in-memory PGLite and applies `migrations/*.sql`.

## Compliance notes

- Reddit tokens and client secrets are encrypted at rest. Origins are allowlisted.
- Telegram webhook secrets are header-only. Photo proxy requires a session.
- Cron takes a Postgres advisory lock so overlapping Vercel invocations cannot double-fire.
- Duplicate migration numbers fail CI (`scripts/check-migration-unique.mjs`).
- Privacy, terms, and a static status page live at `/privacy`, `/terms`, and `/status`.
- Unofficial FXTwitter lookup is off on Vercel unless `FXTWITTER_ENABLED=true`.
- `npm test` covers flags, webhook hashing, desk numbers, Reddit health, Telegram hardening.
- `npm run smoke -- https://your-app.vercel.app` hits `/`, legal pages, and `/robots.txt`.

See `SECURITY.md` before putting real traffic on a deployment.
