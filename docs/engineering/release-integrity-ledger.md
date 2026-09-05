# X Relay — release integrity ledger

**Repository:** `ranoli90/x-relay-studio`  
**Baseline SHA:** `ffa219de7a7916e295b07a1e3d3086eb17b30d24` (main at start of this work)  
**Branch:** `fix/containment-f01-f03`  
**This commit:** (tip of `fix/containment-f01-f03`; recorded in the PR)  
**Mode:** Implementation. No production deploy, live Telegram/X send, or customer charge.

## Outcome labels

- **source-fixed** — code and targeted tests exist; runtime/Postgres concurrency may still be NOT RUN
- **runtime-verified** — executed against the running app / isolated DB
- **blocked** — cannot execute here
- **not run**
- **open**

## Stage 0 — rebaseline

| Item | Status | Notes |
|---|---|---|
| Current main | `ffa219de` | Matches audit cutoff. Open PRs at start: none. |
| `/desk` deprecation | preserved | redirect to `/telegram/app` kept; `DeskShell` not restored |
| Auth | ON | existing desk accounts |
| Database | ON | Neon in deploy; PGLite in preview |
| Simulator | gated | `XRELAY_ALLOW_SIMULATOR=isolated-fixture` and never in production |

## Findings (this PR — Stage 1 containment)

| ID | Title | Status | Changed files | Tests | Remaining |
|---|---|---|---|---|---|
| F01 / XR-001 | Cross-desk `markDelivered` | source-fixed | `src/lib/agent/owned.ts`, `fns.ts` | `owned.test.ts` two-tenant PGlite — pass | Real Postgres concurrency NOT RUN |
| F02 / XR-002 | Production `simulatePay` / inbound | source-fixed | `runtime.ts`, `fns.ts` | `runtime.test.ts` — pass | Built-route inventory NOT RUN on Vercel |
| F03 | AI consent at worker | source-fixed | `ingest-telegram.server.ts`, `watch.server.ts`, `session.server.ts`, settings | `consent.test.ts` — pass | Browser E2E NOT RUN |
| F16 / XR-040 | Local save labeled sent | source-fixed | `fns.ts` approve/operatorSend; `brain.server.ts` `auto=false` | `owned.test.ts` approve → `approved` | Transport still human-only |
| F17 / XR-057 | Handoff still writes | source-fixed | `safety.ts`, `brain.server.ts`, `write.ts` | `agent.test.ts` `safetyBlocksGenerate` | Remote gateway NOT RUN |
| F20 / XR-043 | Demo seed in production | source-fixed | `seed.server.ts` | seed gated on isolated-fixture | Existing rows not cleaned |
| D03 | Home copy vs Settings | source-fixed | `platform-chooser.tsx`, `settings.tsx` | visual smoke | Catalog/checkout still not in Settings |
| D04 | Writer payment/proof claims | source-fixed | `write.ts` | `write.test.ts` — pass | Remote writer prompts NOT RUN |
| D01 | Competing migrators | partial | `db.ts` + `migrate.mjs` `pg_advisory_xact_lock(0x58524c31)` | lock present | Build still migrates; replacement release job open |
| D02 | `ensureDbReady` Neon noop | partial | `db.ts` failed-pool cleanup | | Read-only readiness not split |
| F11 | Onboarding forces watching | source-fixed | `session.server.ts` `finishUserOnboarding` | | Browser onboarding NOT RUN |
| F15 | Jobs marked done on error | source-fixed | `brain.server.ts` `tickAgentJobs` | fail → `retry_wait`, not `done_at` | Retry/lease still open |
| XR-016 | Identity validators on agent RPCs | source-fixed | `owned.ts` zod schemas on simulate/approve/drop/takeover/send/pay/deliver | parse-time | Remaining RPCs still identity validators |
| F04–F14, F18–F22, remaining XR | Remaining stages | open | — | — | Stages 2–9 |

## Simulator / fixture env

`XRELAY_ALLOW_SIMULATOR=isolated-fixture` required for `simulatePay`, `simulateInbound`, and demo fan/proof seed. Production (`VERCEL` or `NODE_ENV=production`) always rejects. Watching is not processing consent; `automation_armed` is.

## Schema

`migrations/0022_containment.sql` — additive job recovery columns (`status`, `attempt_count`, `last_error`, `claim_token`, `claim_until`). Rollback: leave columns; they are unused by older code. Do not edit already-applied files.

## Commands (this environment)

| Command | Exit | Notes |
|---|---|---|
| Containment unit tests (`owned`, `consent`, `write`, `runtime`, `agent`) | 0 | 29/29 pass |
| `npm run typecheck` | 0 | |
| `npm run build` | 0 | migrate skipped (no `DATABASE_URL`; PGLite self-migrates) |
| Dev browser smoke desktop+mobile | 0 | 200, title “X Relay”, no console/page errors, no overflow |
| `npm test` scripts suite | 1 | 182 pass / 13 fail — pre-existing template invariants (auth-off, OG, `with-app-env`, migration-plan glob). Adding `0022` appears in that already-failing glob list. |
| `npm test` src files | 1 | 137 pass / 4 fail — pre-existing (`photo-peer` `"00"`, `rate.test.ts` `@/lib` alias, Reddit UA / OAuth slash). New containment tests pass. |
| Built preview `:8081` | blocked | `NODE_ENV=production` + no `DATABASE_URL` throws by design. Vercel injects `DATABASE_URL`. Not weakened. |
| Real Postgres two-tenant / competing migrators | not run | No Postgres in this sandbox |
| Live Telegram send / Plisio charge / Vercel deploy | not run | Forbidden this PR |

## Rollback

Revert the branch. Additive migration 0022 is compatible with previous application code. Simulator remains off without the isolated-fixture flag.

## Deployment state

Nothing deployed. Nothing sent. No credentials rotated. No production data erased.
