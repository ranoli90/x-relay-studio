# Reddit onboarding implementation ledger

Reviewed baseline: `main` at `beeab5c7ca76ccac3cfa25eabf371f573561519d` (2026-09-05).
Working branch: `feat/reddit-onboarding` @ `daa7dc4`.
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
- `src/components/reddit/onboarding/*` (chooser first: Create 1–5, or Connect my own)
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

## Continuation — worker restore, handoff, ops (2026-09-06)

Preserved `feat/reddit-onboarding` (did not reset).

### Restored / repaired
- `worker-core.ts`: restored `handleCommand` after truncation. Allocation intents persist context/session ids immediately. Timeouts map to `SESSION_AMBIGUOUS`. Fixture path uses `FakePageDriver` + `runBoundedSignup`. No `TEST signup fixture` classify. Owner-scoped `drainOwnedPreview`. No unsafe unscoped claim fallback.
- Coordinator: assisted → manual calls `handoffOnboardingToManual` on the same job. Username is required; never substituted with `user`. Idempotency keys are retained for retries of the same logical request.
- Worker process: `pool.on('error')` and SIGTERM/SIGINT wait for in-flight drain.
- Flags: `REDDIT_DRAFTING_ENABLED`, `REDDIT_PUBLISH_ENABLED`, `REDDIT_EMAIL_BINDING_ENABLED`, `redditRuntimeClass()`. CI also runs on `feat/**`.
- Ops: `operator-guide.md`, credential inventory (dry-run, metadata only), `postgres-race.test.ts` (skips without `REDDIT_TEST_DATABASE_URL`).

### Tests
`npm run test:reddit-onboarding` (2026-09-06): **107 passed, 0 failed, 3 skipped** (`RC-001` live Postgres unset). Credential-inventory CLI test passed.

Live Reddit, live Browserbase, production migrate, and merge/deploy were **not** done.

## Continuation — isolated preview + remaining review repairs (`daa7dc4`)

Preserved `feat/reddit-onboarding` (did not reset). Unattended Reddit signup remains forbidden.

### Playable isolated preview
- Fixture HTML: owner-only CAPTCHA, terms, and final submit; posts username back to the coordinator.
- `completeFixtureConnect` attaches a local identity (no live Reddit). Forced off when `VERCEL` is set.
- Coordinator: Automate/Manual/existing-account finish through fixture connect + health. Resume no longer dumps `needs_user` into Human Control unless `controlOwner=user`.
- Dashboard wires close-browser / disconnect / retained-delete / email / draft RPCs.
- Health and inbox short-circuit when the fixture flag is on.

### Review repairs
- OAuth callback gate: origin/purpose/correlation/generation/cancel/replay/busy/recover/uncertain. Popup missing correlation is not a wildcard.
- Reject-grant AAD pins to owner, not job id.
- Cancel writes `cancelled_at` in the same transaction as the job transition.
- `disconnectRelay` disables the account and queues cleanup atomically.
- Ambiguous session create queues `delete_context`. `end_takeover` revokes the control view.
- `upsertApp({ rotateCredentials: true })` bumps `credential_version`.
- Confirm refuses disabled / unhealthy / cancelled jobs.

### Tests
`npm run test:reddit-onboarding`: **122 passed, 0 failed, 3 skipped**. Typecheck clean.

Live Reddit, live Browserbase, production migrate, and merge/deploy were **not** done.

## Continuation — Create 1–5 or Connect my own

The Reddit door hid the chooser on hosted (`REDDIT_ONBOARDING_ENABLED` defaulted off) and buried connect as a ghost control. First screen is now two options:

- **Create accounts** — pick 1–5. Five queues all five and starts making them in order (one live job; remaining slots on `reddit_onboarding_batches`).
- **Connect my own** — ordinary OAuth.

`0032_reddit_create_batch.sql` is additive. Unattended CAPTCHA/terms still not implemented. Assisted live start still needs a real browser host (Steel / local / Browserbase), not fake-on-Vercel.

## Continuation — Create 1–5 or Connect my own

The Reddit door hid the chooser on hosted (`REDDIT_ONBOARDING_ENABLED` defaulted off) and buried connect as a ghost control. First screen is now two options:

- **Create accounts** — pick 1–5. Five queues all five and starts making them in order (one live job; remaining slots on `reddit_onboarding_batches`).
- **Connect my own** — ordinary OAuth.

`0032_reddit_create_batch.sql` is additive. Unattended CAPTCHA/terms still not implemented. Assisted live start still needs a real browser host (Steel / local / Browserbase), not fake-on-Vercel.


