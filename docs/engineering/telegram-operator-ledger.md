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
| T00 | IN_PROGRESS | this ledger, ADR, PR41 disposition |
| T01 | IN_PROGRESS | FinalState + revalidateForSend after lease; permission defaults off |
| T02 | IN_PROGRESS | ingest processing_permission; fair ingest; send_attempts |
| T03 | IN_PROGRESS | atomic publish, isolated flag, Money, catalogForPlanning |
| T04 | IN_PROGRESS | interpretMessage wired into understandLocal + brain |
| T05 | IN_PROGRESS | pay.ts currency/destination; attestation ≠ settlement |
| T06 | IN_PROGRESS | media assets/proposals; honest copy |
| T07 | IN_PROGRESS | Inbox/Business/Media/Activity/Settings; IME; drafts; unread |
| T08 | IN_PROGRESS | healthIsReady requires route_capable |
| T09 | IN_PROGRESS | tenant-scoped queries; no secret in public payment view |
| T10 | IN_PROGRESS | operator tests + CI build/typecheck on repair/** |
| T11 | NOT_RUN | no production deploy authorized |

## Test commands (this workspace)

| Command | Exit | Notes |
|---|---|---|
| `node scripts/check-migration-unique.mjs` | 0 | 35 migrations, unique prefixes |
| `npx tsc --noEmit` | 0 | |
| targeted operator/auto/pay/agent/conversation/mirror tests | 0 | 118 pass |
| `npm test` | 0 | 541 tests, 538 pass, 3 skipped |
| `npm run build` | 0 | after teleproto present in node_modules |

Live Telegram / paid processor / production migration / authenticated browser E2E: **NOT_RUN**.
