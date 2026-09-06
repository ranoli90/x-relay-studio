# Continuation contract (PR #21)

Do not invent a second coordinator, store, worker, or account table.
Preserve Automate / Manual / Existing-account. Assisted signup stays off.

## Shared files (already written — extend, do not replace)

- `src/lib/reddit/onboarding/types.ts`
- `src/lib/reddit/onboarding/sql.ts` (`runOnboardingTx`, `withSqlTransaction`, `markPinned`)
- `migrations/0029_reddit_onboarding_lifecycle.sql`

## Production transactions

Never send BEGIN/COMMIT through the pool `getSql()`. Use `runOnboardingTx` from
`sql.ts` (wraps `withTransaction` in `src/lib/db.ts`). Nested `getSql()` is ALS-pinned.

PGlite tests may pass a single-connection wrapper into `withSqlTransaction`.

## Feature flags (new names, disabled by default)

- `REDDIT_DRAFTING_ENABLED` — OpenRouter draft composer
- `REDDIT_PUBLISH_ENABLED` — never on; copy/open-in-Reddit is the default
- `REDDIT_EMAIL_BINDING_ENABLED` — managed alias/inbox; existing inbox always works
- `REDDIT_ONBOARDING_FIXTURE` — local fixture site only

## Safety

No CAPTCHA solvers, proxy rotation, disposable mail factories, karma/warm-up,
password storage expansions, or live Reddit/Browserbase calls in tests.
