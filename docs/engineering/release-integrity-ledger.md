# X Relay — release integrity ledger

**Repository:** `ranoli90/x-relay-studio`  
**Audited baseline SHA:** `b68f737d360d6f40e94307df53b9e96f64e99f0e` (main at audit, 2026-09-06)  
**Working branch:** `repair/conversation-kernel`  
**Mode:** Implementation against the isolated sandbox copy of the audited baseline. No live Telegram sends, invoices, production migrations, private-data model tests, or paid probes.

Open GitHub PRs were inventoried and **not merged**: [#14](https://github.com/ranoli90/x-relay-studio/pull/14), [#17](https://github.com/ranoli90/x-relay-studio/pull/17), [#18](https://github.com/ranoli90/x-relay-studio/pull/18), [#21](https://github.com/ranoli90/x-relay-studio/pull/21) plus Dependabot. Migration **0031** is reserved because main ends at 0027 and Reddit #21 uses 0027–0030.

Phone-login retry policy in this baseline (auth five attempts, ordinary writes one) is preserved.

## Outcome labels

- **source-fixed** — code and targeted tests exist; runtime/Postgres concurrency may still be NOT RUN
- **runtime-verified** — executed against the running app / isolated DB
- **blocked** — cannot execute here
- **not run**
- **open**

## PR-00

| Item | Status | Notes |
|---|---|---|
| Workspace SHA | `b68f737` | Matches the audit baseline. GitHub `main` may have moved (Dependabot PRs targeting a later SHA); this repair is against the audited tree. |
| Next migration | `0031_conversation_repair.sql` | Additive. Existing autopilot rows are held in `draft`. |
| Unrelated PRs | not merged | #14 containment, #17 rapport, #18 memory, #21 Reddit |

## Findings (this wave)

| Finding | Priority | Phase | Disposition | Notes |
|---|---|---|---|---|
| XR-001 | P0 | PR-01/04 | source-fixed | Failed/missing generation is held; local templates are not auto-sendable. |
| XR-002 | P0 | PR-01/02 | source-fixed | Thread persona, not `ensureSeed` first persona. |
| XR-003 | P1 | PR-05 | source-fixed | Greeting is W5; identity ask is not proof. |
| XR-004–011 | P0/P1 | PR-02 | source-fixed | Scoped facts, confirmed transcript, placeholder names. |
| XR-012 | P0 | PR-03 | source-fixed | Activation watermark; historical import is `imported`. |
| XR-013–015 | P0/P1 | PR-03 | source-fixed | Per-row CAS claim; `retry_wait` with backoff; stored idempotency result. Expired/missing leases reclaim instead of short-circuiting. Live two-worker SKIP LOCKED NOT RUN. |
| XR-016–017 | P0 | PR-02/04/05 | source-fixed | Confirmed history only to the writer. |
| XR-019–023 | P1/P2 | PR-04 | source-fixed | finish_reason/usage/error class; refusals are terminal. Live provider probe NOT RUN. |
| XR-024–027 | P0/P1 | PR-01/03 | source-fixed | Per-bubble ack; not_live is local, not sent. |
| XR-028–030 | P0 | PR-01 | source-fixed | Reads do not rearm; operator can turn auto-send off; emergency stop persists. |
| XR-031 | P1 | PR-03/05/07 | source-fixed | Check-ins use `writeWithGateway`; local templates held. Fair last-sync order. Hosting schedule NOT RUN. |
| XR-032–034 | P0/P1 | PR-06 | source-fixed | Per-partner GFE reservation; proof CAS; offers inserted as `draft`. |
| XR-035 | P1 | PR-05/06 | source-fixed | Active fulfillment is preserved across smalltalk. |
| XR-036 | P0 | PR-06 | source-fixed | Exact minor units vs quoted item. |
| XR-038 | P0 | PR-06 | source-fixed | Savepoint + SQLSTATE unique; draft not payable; cross-offer replay conflict. Simultaneous callback on real Postgres NOT RUN. |
| XR-041–042 | P1 | PR-07 | source-fixed | Oldest-sync-first desks; emergency stop skips. Real two-worker SKIP LOCKED NOT RUN. |
| XR-043–045 | P1 | PR-08 | source-fixed | Floor switches honor stored flags; emergency stop control restored. |
| XR-046 | P1 | PR-09 | open | Typecheck pass. Src unit tests pass (314). Production build pass. Dev + built-output browser smoke pass, no console errors. `npm test` still short-circuits on 13 `scripts/*.test.mjs` template-chrome checks (auth-off template vs this auth-on product) — pre-existing vs this app, not conversation-kernel regressions. Live Telegram/OpenRouter/Postgres two-worker still NOT RUN. |
| XR-047 | P1 | PR-02/08 | source-fixed | Persona from the requested thread. |
| XR-048 | P0 | RELEASE-GATE | blocked | Telegram-to-external-AI permission not authorized by this handoff. |
| XR-049 | P2 | PR-00 | source-fixed | Baseline/delta recorded here. |
| XR-050 | P2 | PR-08/09 | source-fixed | README and environments.md document draft-hold, emergency stop, and that reads do not rearm. |

## What was not tested

- Live Telegram, live OpenRouter/xAI, real invoices, production Neon migrations
- Two-worker PostgreSQL races
- Independent naturalness review of full synthetic conversations
- Browser E2E of FloorSwitch against a logged-in desk (preview smoke covers render)

## Rollback

Revert `repair/conversation-kernel` to `b68f737`. Migration 0031 is additive (`if not exists`); rollback is “stop using the new columns / set `automation_mode='draft'` and `emergency_stop=true`”.
