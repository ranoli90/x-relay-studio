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
| `CRON_ENABLED` | default on | set `false` to no-op `/api/cron/studio` |
| Migrations | `npm run db:migrate` from a laptop or a release job | never from `vite build` |

Production boot fails closed without `DATABASE_URL` and `BETTER_AUTH_SECRET`.
