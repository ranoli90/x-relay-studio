# Reddit onboarding implementation ledger

Reviewed baseline: `main` at `beeab5c7ca76ccac3cfa25eabf371f573561519d` (2026-09-05).
Working branch: `feat/reddit-onboarding` @ `8ac6fdd`.
Draft PR: https://github.com/ranoli90/x-relay-studio/pull/21
This work is additive on that SHA. The repository was not reset.

## Phase 0 — inventory

| Item | Recorded value |
|---|---|
| Remote | `https://github.com/ranoli90/x-relay-studio.git` |
| Branch | `feat/reddit-onboarding` (uncommitted implementation) |
| Baseline SHA | `beeab5c7ca76ccac3cfa25eabf371f573561519d` |
| Build vs migrate | `npm run build` no longer invokes `scripts/migrate.mjs` (F09) |
| Isolated test DB | PGlite in unit tests; preview PGlite; production Postgres not touched |
| Account cap | 8, unchanged |
| Assisted signup default | off (`REDDIT_ASSISTED_SIGNUP_ENABLED` must be explicit `true`) |
| Browser provider default | `fake` |

## Phases and files

### F01–F10 (existing product repairs)

| ID | Fix | Files |
|---|---|---|
| F01 | User-scoped bootstrap cache | `src/components/reddit/app.tsx` |
| F02 | Decrypt fail-closed + v2 envelopes | `src/lib/secrets.ts`, `src/lib/reddit/onboarding/vault.ts` |
| F03 | Accurate `privatemessages` copy | `src/lib/reddit/health.ts`, `src/components/reddit/add-account.tsx` |
| F04 | Approval vs form-submit copy | `src/components/reddit/setup-app.tsx` |
| F05 | OAuth popup lifecycle / correlation | `src/components/reddit/add-account.tsx`, `src/routes/api/reddit/oauth/callback.ts` |
| F06 | Atomic cap + identity match | `src/lib/reddit/complete-oauth.ts` |
| F07 | Evidence-qualified health | `src/lib/reddit/health.ts` (`probePublicProfile` stub stays unknown) |
| F08 | Durable disconnect cleanup | `src/lib/reddit/store.ts` `disableAccount`, `src/lib/reddit/onboarding/cleanup.ts` |
| F09 | Remove migrate from build | `package.json`, `scripts/migrate.mjs`, `docs/environments.md` |
| F10 | Zod runtime validation | `src/lib/reddit/onboarding/schemas.ts`, `src/lib/reddit/server.ts` |

### Schema / machine / worker / UI

- `migrations/0027_reddit_onboarding.sql`, `migrations/0028_reddit_onboarding_backfill.sql`
- `src/lib/reddit/onboarding/*` (types, machine, policy, store, vault, worker-core, fake + Browserbase adapters)
- `src/workers/reddit-onboarding.ts` (Postgres worker; no-op without `DATABASE_URL`)
- `src/components/reddit/onboarding/*` (chooser first: Automate, Manual, I already have an account)
- Dashboard Add opens the same coordinator

## Tests run

Command: `npm run test:reddit-onboarding` plus `src/lib/reddit/health.test.ts`, `src/lib/reddit/reddit.test.ts`, `src/lib/flags.test.ts`.

Result (2026-09-05): **40 passed, 0 failed**.

CI `npm test` enumerates:

- `src/lib/reddit/onboarding/machine.test.ts`
- `src/lib/reddit/onboarding/vault.test.ts`
- `src/lib/reddit/onboarding/policy.test.ts`
- `src/lib/reddit/onboarding/store.test.ts`

Typecheck: Reddit onboarding surfaces are clean. `tsc --noEmit` is clean after restoring the already-declared `teleproto` package in this sandbox.

Production `npm run build`: pass (does not run migrations).

## Blockers (not claimed as live success)

- No production migration, deploy, or `DATABASE_URL` cutover.
- No real Reddit signup, Data API approval, Browserbase session, Stagehand model call, or Director runtime.
- `REDDIT_ASSISTED_SIGNUP_ENABLED` stays off. Fake provider is forbidden for assisted signup in production.
- HTML public-profile scrape is fail-closed `unknown` (F07). Owner still confirms in a private window.
- Hosted/remote OAuth transport is disabled until dedicated tests exist.
- CAPTCHA solving, terms auto-accept, disposable mail, posting, voting, messaging, and karma warm-up are not implemented.

## Configuration names (no secret values)

See `.env.example` and `docs/environments.md`. Names only:

`REDDIT_ONBOARDING_ENABLED`, `REDDIT_ASSISTED_SIGNUP_ENABLED`, `REDDIT_REMOTE_OAUTH_ENABLED`, `REDDIT_BROWSER_PROVIDER`, `REDDIT_WORKFLOW_VERSION`, `REDDIT_SESSION_MAX_SECONDS`, `REDDIT_ONBOARDING_GLOBAL_CONCURRENCY`, `REDDIT_BROWSER_CONTEXT_RETENTION_DAYS`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `BROWSERBASE_REGION`, `STAGEHAND_MODEL`, `SECRETS_ENCRYPTION_KEY`, `REDDIT_VAULT_KEY_ID`.

Never prefix provider/model/encryption secrets with `VITE_`.
