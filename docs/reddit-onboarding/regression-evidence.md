# Regression evidence (RC-001..RC-048)

Source matrix: `handoff/REGRESSION_TESTS.md`. None of these is live Reddit, live Browserbase, or production Postgres.

Head recorded after isolated-preview + review repairs on `feat/reddit-onboarding` @ `daa7dc4`.

Command: `npm run test:reddit-onboarding`  
Result: **122 passed, 0 failed, 3 skipped** (PGlite / fake pool / HTTP stubs). `RC-001` live Postgres skipped (`REDDIT_TEST_DATABASE_URL` unset). Typecheck: clean.

Requested subset:

```
node --experimental-strip-types --test \
  src/lib/reddit/onboarding/store.test.ts \
  src/lib/reddit/onboarding/lease.test.ts \
  src/lib/reddit/onboarding/tx.test.ts \
  src/lib/reddit/onboarding/machine.test.ts
```

Result with `cleanup.test.ts` included: **38 passed, 0 failed**.

Status vocabulary: `passed_fixture`; `implemented_unverified`; `blocked_external`; `not_started`.

A mock-provider assertion is not live browser behavior. A fake pool is not PostgreSQL `SKIP LOCKED` across backends. Passing typecheck is not OAuth correctness.

| ID | Area | Status | Evidence | Notes |
|---|---|---|---|---|
| RC-001 | R01 transaction affinity | passed_fixture | `tx.test.ts` tagged 3-connection fake pool | BEGIN/inserts/COMMIT stay on one client; concurrent txs use different clients; nested `withSqlTransaction` reuses. Not a real `pg` Pool. |
| RC-002 | R01 atomic draft failure | passed_fixture | `tx.test.ts` inject after jobs/commands/events | PGlite rollback: no leftover jobs, commands, or events. |
| RC-003 | R01/R10 draft idempotency | passed_fixture | `tx.test.ts`, `store.test.ts` | Same key/body reuses the job; same key/different body is `IDEMPOTENCY_CONFLICT` and does not switch mode. |
| RC-004 | R05 exclusive job claim | passed_fixture | `lease.test.ts` | Two queued commands, two workers: only one live job owner; same owner may claim the second command. PGlite, not two Postgres backends. |
| RC-005 | R05 lease-generation fencing | passed_fixture | `lease.test.ts` | Expired lease taken over; old owner `transitionJob` with old generation → `STALE_LEASE`; status unchanged. |
| RC-006 | R05 lease renewal | passed_fixture | `lease.test.ts` | `renewLease` succeeds for current owner; after forced expiry it throws `STALE_LEASE`. |
| RC-007 | R05 cleanup competing claim | passed_fixture | `lease.test.ts`, `cleanup.test.ts` | Sequential claims do not lease the same task id. True concurrent PostgreSQL `SKIP LOCKED` is still `blocked_external`. |
| RC-008 | R05 owner-scoped drain | passed_fixture | `lease.test.ts` | `claimCommand(sql, worker, 60, {userId, jobId})` cannot take another user's command. |
| RC-009 | R02 OAuth binding write failure | implemented_unverified | `startJobBoundRedditOAuth` + `insertTicket` in `runOnboardingTx` | Binding and job transition share a transaction. Injected ticket-write failure is still not a dedicated fixture. |
| RC-010 | R02/R11 origin and ceremony | passed_fixture | `oauth-callback-gate.test.ts` | Origin, purpose, generation, correlation, cancel, replay, busy, recover, uncertain. Popup missing-correlation is not a wildcard. |
| RC-011 | R03 canonical account ID race | implemented_unverified | `complete-oauth.ts` | Needs isolated PostgreSQL concurrency. |
| RC-012 | R03 cap versus reconnect | implemented_unverified | `complete-oauth.ts` advisory lock, cap 8 | Not re-run as a race fixture here. |
| RC-013 | R11 credential version rotation | passed_fixture | `store.ts` `upsertApp({ rotateCredentials })` | Saving app credentials bumps `credential_version`. Tickets pin `app_credential_version`. No live Reddit re-auth race. |
| RC-014 | R11 wrong-account grant | implemented_unverified | complete-oauth identity match | Cleanup of issued grant is not a new automated test here. |
| RC-015 | R11 cancel before callback | passed_fixture | `oauth-callback-gate.test.ts`, `cancelTicketsForJob` | Cancelled tickets reject. Job cancel writes `cancelled_at` in the same transaction as the job transition. |
| RC-016 | R11 cancel during exchange | implemented_unverified | 0029 exchange timestamps | Callback also rejects cancelled jobs before proceeding. No in-flight exchange race fixture. |
| RC-017 | R11 crash after code exchange | passed_fixture | `oauth-callback-gate.test.ts` recover/uncertain | Linked account recovers; stale processing without an account is uncertain, not a second exchange. |
| RC-018 | R11 final confirmation integrity | passed_fixture | `confirmConnectedIdentity`, `confirmOnboarding` | Disabled, cancelled, missing health, and username mismatch refuse confirmation. Fixture health short-circuits live Reddit. |
| RC-019 | R10/R11 popup and full-page paths | implemented_unverified | `add-account.tsx` | UI paths, not CI. Correlation is required on start. |
| RC-020 | R04 atomic disconnect intent | passed_fixture | `cleanup.test.ts` disableAndQueueDisconnect | Disable + queue roll back together when a later write fails. |
| RC-021 | R04 real revocation adapter | passed_fixture | `cleanup.test.ts` | Missing material → failed `NO_MATERIAL`; missing revoker → `REVOKER_MISSING`; `{ok:false}` → `REVOKE_HTTP_FAILED`; `{ok:true}` → completed. HTTP stub, not Reddit. |
| RC-022 | R04 cleanup summary dependency | passed_fixture | `cleanup.test.ts` | Summary cannot clear `cleanup_pending` while a required child is still queued. |
| RC-023 | R04 revocation secret retention | passed_fixture | `cleanup.test.ts` purge | Temporary secret ciphertext becomes `purged` with `deleted_at`; retained password is left unless that kind runs. |
| RC-024 | R06 context created / session fails | passed_fixture | `worker-core.test.ts` | Ambiguous session create queues `delete_context` for the persisted context id. |
| RC-025 | R06 session response lost | passed_fixture | `store.test.ts` / fake provider | Same `allocationIntentId` reuses the session; lost-create knob exists in `providers/fake.test.ts`. |
| RC-026 | R06 cancel during allocation | implemented_unverified | worker cancel + cleanup | Late receipt discovery not separately asserted. |
| RC-027 | R07 no live fixture shortcut | passed_fixture | `controller.test.ts` | Observes driver title/fields; does not treat a fabricated TEST title as live progress. |
| RC-028 | R07 bounded controller fixture | passed_fixture | `controller.test.ts` | Pause/resume on the fake page driver. |
| RC-029 | R07/R12 owner security checkpoint | passed_fixture | `controller.test.ts`, `policy.test.ts` | CAPTCHA/terms/final submit and password/OTP fills stay owner-only. |
| RC-030 | R09 provider contract states | passed_fixture | `providers/browserbase.test.ts` | PENDING, RUNNING, ERROR, TIMED_OUT, unknown, invalid JSON, 429 mapped on HTTP stubs. |
| RC-031 | R09 provider timeout taxonomy | passed_fixture | `providers/browserbase.test.ts` | AbortError/TypeError, 5xx create vs get. Not live network. |
| RC-032 | R09 release and absence | passed_fixture | `providers/browserbase.test.ts`, `cleanup.test.ts` | 404 get/delete; release-does-not-end keeps cleanup pending. |
| RC-033 | R07/R09 takeover revocation | passed_fixture | `worker-core.test.ts` end_takeover | Ending takeover calls `revokeControlView`. Live Browserbase agreement is still `blocked_external`. |
| RC-034 | R08 consent vs persistence | passed_fixture | `retention.test.ts` | Retention request is not displayed as saved. |
| RC-035 | R08 retained fixture reopen | passed_fixture | `retention.test.ts` | Reopen bound profile under exclusive lease; wrong tenant rejected by owner checks. |
| RC-036 | R08 expired authentication | passed_fixture | `retention.test.ts` `markNeedsReauth` | Expired auth → reauth, not new account creation. |
| RC-037 | R08 restriction handling | passed_fixture | `retention.test.ts`, `readiness.test.ts` | Restricted account pauses; no replacement identity. |
| RC-038 | R08 retention deletion | passed_fixture | `retention.test.ts` | Deletion tracked through confirmation; deleting/orphaned cannot reopen. |
| RC-039 | R10 assisted to manual | passed_fixture | `store.test.ts` | `handoffToManual` on an active assisted job keeps the job, sets mode manual, queues session/context cleanup. |
| RC-040 | R10 lost mutation response | passed_fixture | `store.test.ts` | Same cancel key after `saveDetails` version bump returns the original command (`duplicate: true`). |
| RC-041 | R12 navigation and prompt injection | passed_fixture | `policy.test.ts` | Wrong ports/origins/frames and owner-only clicks denied. Malicious page instructions cannot expand methods. |
| RC-042 | R13 credential upgrade | passed_fixture | `vault.test.ts` | v2 round-trip with AAD; plaintext rejected; v1 decrypt still works. Corrupt/missing-key production paths not fully enumerated. |
| RC-043 | R13 worker shutdown and flags | implemented_unverified | worker no-op without `DATABASE_URL` | No SIGTERM / pool-idle fixture in this slice. |
| RC-044 | Email binding lifecycle | passed_fixture | `email.test.ts` | Existing inbox without provider; managed kinds blocked; timeout reconcile; quota; delete requires verified alternative. |
| RC-045 | Readiness / no invented reputation | passed_fixture | `readiness.test.ts` | Unknown stays unknown; no score; restriction pauses. |
| RC-046 | Drafting scoped generation | passed_fixture | `drafts.test.ts` | Owner allowlist; missing rules; secrets in prompt rejected; injected generator only. |
| RC-047 | Drafting approval / publication | passed_fixture | `drafts.test.ts` | Edit invalidates approval; unknown outcome is not blindly retried; direct publish off. |
| RC-048 | Release evidence gate | passed_fixture | `package.json`, this file | All current `src/lib/reddit/onboarding/*.test.ts`, `providers/*.test.ts`, and `oauth-callback-gate.test.ts` are registered. Current-head CI of production deploy is not this slice. Fixture vs Postgres vs live remain labeled separately. |

## What this slice did not run

- Real PostgreSQL pool size >1 with two backends racing `FOR UPDATE SKIP LOCKED`
- Live Browserbase create/release/delete
- Live Reddit OAuth, signup, or Data API
- Production migrate / `DATABASE_URL` worker cutover

Those stay `blocked_external` and must not be copied into a live-success column.
