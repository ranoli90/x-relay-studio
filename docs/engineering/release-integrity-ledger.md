# X Relay — release integrity ledger

**Repository:** `ranoli90/x-relay-studio`  
**Audited baseline SHA:** `b68f737d360d6f40e94307df53b9e96f64e99f0e` (main at audit, 2026-09-06)  
**Working branch:** `repair/conversation-kernel`  
**Mode:** Implementation against the isolated sandbox copy of the audited baseline. No live Telegram sends, invoices, production migrations, private-data model tests, or paid probes.

Open GitHub PRs were inventoried and **not merged**: [#14](https://github.com/ranoli90/x-relay-studio/pull/14), [#17](https://github.com/ranoli90/x-relay-studio/pull/17), [#18](https://github.com/ranoli90/x-relay-studio/pull/18) plus Dependabot. **[#21](https://github.com/ranoli90/x-relay-studio/pull/21) landed on GitHub `main` after the audit** (`2683ca9`). This repair merges that Reddit onboarding line in. Migration **0031** stays the conversation-kernel additive migration (Reddit used 0027–0030; the duplicate `0027_reddit_onboarding.sql` vs `0027_autopilot_always_on.sql` pair is grandfathered, not renamed).

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
| Unrelated PRs | #14 #17 #18 not merged | #21 already on GitHub main; merged into this branch. Duplicate 0027 filenames grandfathered. |

## Findings

| Finding | Priority | Phase | Disposition | Notes |
|---|---|---|---|---|
| XR-001 | P0 | PR-01/04 | source-fixed | Failed/missing generation is held; local templates are stored as `local_template`, not `validated_model`. |
| XR-002 | P0 | PR-01/02 | source-fixed | Thread persona, not `ensureSeed` first persona. |
| XR-003 | P1 | PR-05 | source-fixed | Greeting is W5; identity ask is not proof. |
| XR-004–010 | P0/P1 | PR-02 | source-fixed | Scoped facts, confirmed transcript, placeholder names. |
| XR-011 | P0 | PR-02/03 | source-fixed | Watch `from_self` upserts `role=persona`, `status=sent`, `origin=human_manual`. Drain still ignores `from_self`. Deduped by transport id. |
| XR-012 | P0 | PR-03 | source-fixed | Activation watermark; historical import is `imported`. |
| XR-013–015 | P0/P1 | PR-03 | source-fixed | Per-row CAS claim; `retry_wait` with backoff; stored idempotency result. Expired/missing leases reclaim instead of short-circuiting. Live two-worker SKIP LOCKED NOT RUN. |
| XR-016–017 | P0 | PR-02/04/05 | source-fixed | Confirmed history only to the writer. `buildWriterMessages` keeps diary/inbound/bible in the untrusted USER payload; system policy is stable. |
| XR-018 | P1 | PR-05 | source-fixed | Writer policy: answer the actual message, one bubble is normal, zero questions is fine, honest AI identity. Local templates remain held. Independent naturalness review NOT RUN. |
| XR-019–023 | P1/P2 | PR-04 | source-fixed | finish_reason/usage/error class; refusals/truncated/empty are terminal. Ping returns `{ok,health}`; watch stamps ready only on `ping.ok`. One end-to-end deadline. Live provider probe NOT RUN. |
| XR-024–027 | P0/P1 | PR-01/03 | source-fixed | Per-bubble ack; not_live is local, not sent. Pre-send fence on emergency stop / takeover / opt-out. Distinct reply ids with the same body are distinct intents. |
| XR-028–030 | P0 | PR-01 | source-fixed | Reads do not rearm; operator can turn auto-send off; emergency stop persists. |
| XR-031 | P1 | PR-03/05/07 | source-fixed | Check-ins use `writeWithGateway`; local templates held. Cron runs Telegram `tickAutoSendOnce` before X scrape/drip. Hosting schedule NOT RUN. |
| XR-032–034 | P0/P1 | PR-06 | source-fixed | Per-partner GFE reservation; proof CAS; offers inserted as `draft`. |
| XR-035 | P1 | PR-05/06 | source-fixed | Active fulfillment is preserved across smalltalk. |
| XR-036 | P0 | PR-06 | source-fixed | Exact minor units vs quoted item. |
| XR-037 | P1 | PR-06 | source-fixed | `quoteCustom` ignores guessed `lastPaidCents` / lifetime unless an explicit approved quote. Spoken custom is catalog `custom_clip` exact cents. Ladder is operator-preview only. |
| XR-038 | P0 | PR-06 | source-fixed | Savepoint + SQLSTATE unique; draft not payable; cross-offer replay conflict. Simultaneous callback on real Postgres NOT RUN. |
| XR-039 | P1 | PR-03/06 | source-fixed | `availableThreads` before `processInbound`; `forceHold` when credits ≤ 0; burn only if `result.auto`. Held/killed are not billed. Transactional reserve around generation still post-send settle. |
| XR-040 | P1 | PR-06 | source-fixed | Two ledgers documented: Plisio `createThreadInvoice` = operator desk credits; customer offers = generic webhook + operator delivery attestation. No complete buyer checkout adapter. |
| XR-041–042 | P1 | PR-07 | source-fixed | Oldest-sync-first desks; emergency stop skips. `historyChats` is a bounded set of 4. Real two-worker SKIP LOCKED NOT RUN. |
| XR-043–045 | P1 | PR-08 | source-fixed | Floor labels match stored flags: held / local only / uncertain send / approved — not sent / sent. Live pulse requires approved-auto, auto-send, no emergency stop, and a successful writer. Simulator labeled synthetic inbound. |
| XR-046 | P1 | PR-09 | runtime-verified | Typecheck pass. `npm test` 343 pass (scripts then src always). Production build pass. Dev 8080 + built 8081 browser smoke pass, no console errors, no overflow, built does not diverge from landing baseline. Auth stays on. Independent naturalness review and logged-in FloorSwitch E2E NOT RUN. |
| XR-047 | P1 | PR-02/08 | source-fixed | Persona from the requested thread. |
| XR-048 | P0 | RELEASE-GATE | blocked | Telegram-to-external-AI permission not authorized by this handoff. Do not enable the live flow. |
| XR-049 | P2 | PR-00 | source-fixed | Baseline/delta recorded here. |
| XR-050 | P2 | PR-08/09 | source-fixed | README and environments.md document draft-hold, emergency stop, two ledgers, and that reads do not rearm. |

## What was not tested

- Live Telegram, live OpenRouter/xAI, real invoices, production Neon migrations
- Two-worker PostgreSQL races
- Independent naturalness review of full synthetic conversations
- Browser E2E of FloorSwitch against a logged-in desk (preview smoke covers render; `/agents` unauthenticated redirects to the landing desk)
- Telegram API terms §1.4/§1.5 participant-specific consent (XR-048)

## Rollback

Revert `repair/conversation-kernel` to `b68f737`. Migration 0031 is additive (`if not exists`); rollback is “stop using the new columns / set `automation_mode='draft'` and `emergency_stop=true`”.
