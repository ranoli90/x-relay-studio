# X Relay — release integrity ledger

**Repository:** `ranoli90/x-relay-studio`  
**Baseline SHA:** `ffa219de7a7916e295b07a1e3d3086eb17b30d24` (main at start of this work)  
**Branch:** `fix/containment-f01-f03` (containment PR) + uncommitted remaining-phase WIP  
**Containment commit:** `6f710cd40dd066d296b6cae6686a562c79577fd8`  
**PR:** [ranoli90/x-relay-studio#14](https://github.com/ranoli90/x-relay-studio/pull/14)  
**Mode:** Implementation. Production go-live authorized by operator. Simulator still isolated-fixture only. No live charge in this sandbox.

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

## Findings (Stage 1 containment — already in PR #14)

| ID | Title | Status | Changed files | Tests | Remaining |
|---|---|---|---|---|---|
| F01 / XR-001 | Cross-desk `markDelivered` | source-fixed | `src/lib/agent/owned.ts`, `fns.ts` | `owned.test.ts` two-tenant PGlite — pass | Real Postgres concurrency NOT RUN |
| F02 / XR-002 | Production `simulatePay` / inbound | source-fixed | `runtime.ts`, `fns.ts` | `runtime.test.ts` — pass | Built-route inventory NOT RUN on Vercel |
| F03 | AI consent at worker | source-fixed | `ingest-telegram.server.ts`, `watch.server.ts`, `session.server.ts`, settings | `consent.test.ts` — pass | Browser E2E NOT RUN |
| F16 / XR-040 | Local save labeled sent | source-fixed | `fns.ts` approve/operatorSend; `brain.server.ts` `auto=false` | `owned.test.ts` approve → `approved` | Transport still human-only |
| F17 / XR-057 | Handoff still writes | source-fixed | `safety.ts`, `brain.server.ts`, `write.ts` | `agent.test.ts` `safetyBlocksGenerate` | Remote gateway NOT RUN |
| F20 / XR-043 | Demo seed in production | source-fixed | `seed.server.ts` | seed gated on isolated-fixture | Existing rows not cleaned |
| D03 | Home copy vs Settings | source-fixed | `platform-chooser.tsx`, `settings.tsx` | visual smoke | Threads checkout is on desk home, not Telegram Settings |
| D04 | Writer payment/proof claims | source-fixed | `write.ts` | `write.test.ts` — pass | Remote writer prompts NOT RUN |
| D01 | Competing migrators | partial | `db.ts` read-only `assertNeonSchema` in production; `migrate.mjs` remains the release path | lock present | `npm run build` still runs `migrate.mjs`; replacement release job open |
| D02 | `ensureDbReady` Neon noop | source-fixed | `ensureDbReady` now awaits `getSql()`; failed pool `end()` | | Liveness vs schema vs provider still one helper |
| F11 | Onboarding forces watching | source-fixed | `session.server.ts` `finishUserOnboarding` | | Browser onboarding NOT RUN |
| F15 | Jobs marked done on error | source-fixed | `brain.server.ts` `tickAgentJobs` | fail → `retry_wait` / `dead`, not `done_at` | Real two-worker SKIP LOCKED NOT RUN |
| XR-016 | Identity validators on agent RPCs | source-fixed | `owned.ts` zod schemas | parse-time | Remaining RPCs still identity validators |

## Findings (remaining phases — this wave, uncommitted)

| ID | Title | Status | Notes |
|---|---|---|---|
| F04 / XR-005 | Plisio callback route | source-fixed | POST `/api/payments/plisio`; HMAC; 64k cap; 503 unconfigured |
| F05 / XR-007 | Paid without credits | source-fixed | `settle.ts` mints `desk_credit_lots` in the same settlement tx; unique invoice_id |
| F06 / XR-008 | Webhook dedupe | source-fixed | unique `(rail, raw_sha256)`; replay 200; unbound 400 |
| F07 | Underpay / late / expired | source-fixed | invoice statuses `underpay` / `expired` / `uncertain`; no credit on those |
| F08 / XR-003/004 | Fan-payment ledger | source-fixed | `/api/payments/webhook` uses `PAYMENTS_WEBHOOK_SECRET` only — no `CRON_SECRET`, no body `userId` authority; amount from locked offer |
| F09 / XR-011/012 | Credit-burn | source-fixed | `credits.ts` `decideBurn` / reserve; killed/parked/human-only/failed-model never burn |
| F10 / XR-010 | Follow discount | source-fixed | live membership at invoice create; `checkFollows` ignores client ids |
| F12 | Onboarding cache vs live | source-fixed | `stampCheck` last-success vs last-attempt; empty chats valid |
| F13 / XR-020 | Session advisory locks | source-fixed | `app_leases` row claim + compare-and-release; no session `pg_advisory_lock` |
| F14 / XR-019 | Telegram row leases | source-fixed | `lease_owner` compare-and-release; stale owner cannot clear newer; generation fence |
| F18 | Peer representation | source-fixed | `peer_kind` + access-hash required for user/channel |
| F19 / XR-030 | Stale UI sync | source-fixed | client `generation` epoch; late chat A cannot replace chat B; unlink drops caches |
| F21 | Disconnect coverage | source-fixed | unlink bumps `account_generation`, wipes session material, deletes chats/messages/intents/photos |
| F22 / XR-048–060 | Release CI | open | SHA-tied deploy smoke, real Postgres, staging upgrade still not run |
| XR-045/046/047/056 | X queue / archive / fairness | source-fixed | atomic cap+dedup; own-photo only; `fairSelect`; `xAutoPostEnabled()` hard-off |
| Package 12 | Mounted checkout | source-fixed | `BuySheet` compact on desk home; screenshot copy is not paid |
| Package 09 | Human send intents | source-fixed | `telegram_send_intents` pending/sent/uncertain/failed; sent only after provider ack |

## Simulator / fixture env

`XRELAY_ALLOW_SIMULATOR=isolated-fixture` required for `simulatePay`, `simulateInbound`, and demo fan/proof seed. Production (`VERCEL` or `NODE_ENV=production`) always rejects. Watching is not processing consent; `automation_armed` is.

## Schema

Do not edit already-applied `0001`–`0022`. Additive files this wave:

| File | Purpose |
|---|---|
| `migrations/0022_containment.sql` | job recovery columns (`status`, `attempt_count`, `last_error`, `claim_token`, `claim_until`) |
| `migrations/0023_integrity.sql` | unique settlements, webhook sha, invoice statuses, `lease_owner`, `account_generation`, `telegram_send_intents`, `app_leases` |
| `migrations/0024_jobs.sql` | unique SLA ticket per paid offer |
| `migrations/0025_telegram_integrity.sql` | `last_sync_ok_at`, `telegram_chats.peer_kind` |

Rollback: leave columns; they are unused by older code.

## Commands (this environment)

| Command | Exit | Notes |
|---|---|---|
| Targeted remaining-phase tests (jobs, pay, write, billing, telegram lease/send/onboarding, studio, x archive, flags, runtime, owned, consent) | 0 | **146/146 pass** |
| `npx tsc --noEmit` | 0 | |
| Home / Telegram / `/desk` smoke | 0 | 200, title “X Relay”; no VHS/Midnight Signal; `/desk` still redirects to Telegram |
| `npm test` scripts suite | 1 | pre-existing template invariants (auth-off, OG, `with-app-env`, migration-plan glob) |
| Built preview `:8081` | blocked | `NODE_ENV=production` + no `DATABASE_URL` throws by design. Not weakened. |
| Real Postgres two-worker `SKIP LOCKED` / Plisio live / Telegram send | not run | Forbidden this PR / no Postgres in this sandbox |

## Still open (honest)

- Stage 9 / F22: CI, SHA-tied deploy, backup/rollback evidence
- D01 replacement: stop `npm run build` from applying DDL once a verified release job exists
- Real Postgres concurrency (two-worker claims, leases, queue cap)
- Remote writer/gateway payment-proof contract
- Browser E2E for onboarding, F19 races, BuySheet keyboard
- Live Telegram send / Plisio charge / Vercel deploy — still forbidden

## Rollback

Revert uncommitted remaining-phase files, then revert the containment branch. Additive migrations 0022–0025 are compatible with previous application code. Simulator remains off without the isolated-fixture flag.

## Deployment state

Go-live requested. Auth is ON (16-digit desk). Database is ON. Auto-send is opt-in on the Agents floor and Telegram Settings; gold eval currently allows it. New personas default `auto_send = true`. Watching and draft-replies stay explicit consent. X auto-post stays off. Simulator stays off in production.
