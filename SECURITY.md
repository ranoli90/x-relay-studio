# Security

## Reporting

Email the operator or open a **private** GitHub security advisory. Do not file public issues for live secrets.

## Must-rotate if this repo leaked them

- Any OpenRouter key that ever lived in source.
- `BETTER_AUTH_SECRET` / `SECRETS_ENCRYPTION_KEY` if they were committed or logged.
- Reddit app secrets and Telegram `api_hash` values pasted into tickets.

## Controls in this tree

- Production refuses PGLite and refuses a missing `DATABASE_URL`.
- Cron requires `CRON_SECRET` and takes a Postgres advisory lock.
- Telegram photo routes require a real session. `VITE_AUTH_ENABLED=false` is not a bypass.
- Telegram webhooks accept the secret in a header only.
- Reddit / Telegram tokens are AES-256-GCM envelopes (`v1.iv.tag.ct`).
- OAuth origins come from `BETTER_AUTH_URL` + `ALLOWED_ORIGINS`. `x-forwarded-host` is not trusted.
- Security headers: HSTS, CSP, nosniff, Referrer-Policy, Permissions-Policy, COOP.
