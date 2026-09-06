# Environments

| | Preview | Production |
|---|---|---|
| Host | `*.vercel.app` preview URL | `BETTER_AUTH_URL` |
| Database | Neon (same cluster is acceptable only if you accept leaked preview desks) | Neon pooled `DATABASE_URL` |
| `BETTER_AUTH_SECRET` | required | required, distinct from preview if DBs differ |
| `CRON_SECRET` | optional (cron is prod-only on Vercel) | required |
| `OPENROUTER_API_KEY` | optional | required for rewrite |
| `FXTWITTER_ENABLED` | defaults on locally, **off** on Vercel | off unless you accept unofficial X lookup |
| `TELEGRAM_MTPROTO_ENABLED` | default on | set `false` to kill the user client |
| `REDDIT_ENABLED` | default on | set `false` to refuse OAuth start |
| `REDDIT_ONBOARDING_ENABLED` | default on | default on. Set `false` to hide Create vs Connect. |
| `REDDIT_ASSISTED_SIGNUP_ENABLED` | default off | remains off without approval + Browserbase |
| `REDDIT_BROWSER_PROVIDER` | `fake` | must be `browserbase` before assisted signup |
| Reddit onboarding worker | no-op without `DATABASE_URL`; preview drains fake commands in-process | `npm run worker:reddit-onboarding` with Postgres |
| `CRON_ENABLED` | default on | set `false` to no-op `/api/cron/studio` |
| Migrations | Neon applies pending files on first connect (advisory lock). `npm run db:migrate` remains the laptop/release path. Never from `vite build`. `0031_conversation_repair.sql` is additive and holds existing autopilot in `draft` until an operator reviews Auto-send. Set `XRELAY_MIGRATE_ON_START=0` to fail-closed instead of applying. |

Telegram conversation work is synthetic-only until the Telegram-to-external-AI permission gate (XR-048) is reviewed. Live partner sends, invoices, and paid provider probes are not authorized by the conversation-repair wave.

Production boot fails closed without `DATABASE_URL` and `BETTER_AUTH_SECRET`.

## Billing ledgers

`PLISIO_SECRET` is operator desk-credit checkout only (`createThreadInvoice` → thread packs). `PAYMENTS_WEBHOOK_SECRET` is the generic fan-offer webhook. They are different ledgers. Plisio does not settle customer offers. There is no complete isolated buyer checkout/fulfillment adapter in this wave. Retired catalog SKUs stay disabled.

Do not run `npm run build` against a production database to “test” migrations. Use `npm run db:migrate` with an isolated `DATABASE_URL`.
