# Telegram operator repair ledger

Workspace: `ranoli90/x-relay-studio`
Audit main: `2e16ef71c29606b756f937297de2e5dc38eff2e0`
Branch: `repair/telegram-assistant-kernel`
Authority: isolated branch only. No production deploy, migration, live Telegram, or invoices.

## Environment recorded at start

| Item | Value |
|---|---|
| Remote | https://github.com/ranoli90/x-relay-studio.git |
| HEAD at branch start | 2e16ef71c29606b756f937297de2e5dc38eff2e0 |
| Node | v22.23.2 |
| Package manager | npm (lockfile present) |
| Latest product migration before repair | 0033_reddit_create_batch.sql |
| This repair migration | 0034_operator_telegram.sql |
| Preview fixtures | `XRELAY_ALLOW_SIMULATOR=isolated-fixture` |
| PR41 | reviewed, not merged |

## Frozen contracts

- Canonical IDs: `newOperatorId(prefix)` → `{prefix}_{hex}`
- Money: integer minor + ISO-4217 code. Never infer USD.
- Consent: processing permission defaults false; owner login is not correspondent consent.
- Quote: published revision + service_key + amount_minor + currency + destination.
- Outbox: send_attempts statuses include uncertain; cancel after possible transmission is not non-delivery.

## Task status

| Task | Disposition | Evidence |
|---|---|---|
| T00 | SOURCE_FIXED | this ledger, ADR, PR41 disposition, deletion-inventory |
| T01 | SOURCE_FIXED | FinalState + revalidateForSend after lease; permission defaults off; conversationPermitted from live flags |
| T02 | SOURCE_FIXED | ingest processing_permission; fair ingest; burst debounce; send_attempts |
| T03 | SOURCE_FIXED | atomic publish, isolated flag, Money, catalogForPlanning fail-closed |
| T04 | SOURCE_FIXED | interpretMessage wired into understandLocal + brain |
| T05 | SOURCE_FIXED | pay.ts currency/destination; attestation ≠ settlement |
| T06 | SOURCE_FIXED | media assets/proposals; honest copy |
| T07 | SOURCE_FIXED | Inbox/Business/Media/Activity/Settings; IME; drafts; unread |
| T08 | SOURCE_FIXED | healthIsReady requires route_capable |
| T09 | SOURCE_FIXED | tenant-scoped queries; rememberFan requires userId; unlink erases derived data |
| T10 | SOURCE_FIXED | operator tests + CI build/typecheck on repair/** |
| T11 | NOT_RUN | no production deploy authorized |

## Test commands (this workspace)

| Command | Exit | Notes |
|---|---|---|
| `node scripts/check-migration-unique.mjs` | 0 | 35 migrations, unique prefixes |
| `npx tsc --noEmit` | 0 | |
| targeted operator/auto/pay/agent/conversation/mirror tests | 0 | 126 pass |
| `npm test` src | 0 | 549 tests, 546 pass, 3 skipped |
| `scripts/grok-pwa-plugin.test.mjs` | 0 | after restoring unrelated dirty PWA file |
| `npm run build` | 0 previously | after teleproto present in node_modules |

Live Telegram / paid processor / production migration / authenticated browser E2E / two-worker SKIP LOCKED: **NOT_RUN**.

## Rollback

Do not roll this branch onto a live desk that had processing permission or auto-send enabled.

1. Keep `processing_permission=false`, `desired_auto_reply=false`, `automation_mode='draft'`, `emergency_stop=true`.
2. Migration `0034_operator_telegram.sql` is additive (`if not exists`). Leave the tables; stop using them.
3. Revert the git branch / PR rather than dropping columns under a running worker.
4. Disconnect already erases operator derived tables; that is irreversible for those rows.

## Release notes (isolated)

- Processing permission still defaults **off**. Owner login is not correspondent consent.
- Published business revisions are the only live catalog. `agent_catalog` is never a live default.
- Money is integer minor + ISO currency. Missing currency fails closed; USD is never inferred.
- Auto-send reads live `processing_permission && !opt_out`. Hardcoded true is gone.
- Inbound bursts wait 1.5s quiet / 8s cap. Poll rate is not raised to catch up.
- Telegram unlink erases the 17 operator derived tables listed in `deletion-inventory.md`.
- This merge is **not** a production go-live. Live Telegram, invoices, and production migrations remain unauthorized.