# Telegram operator slice — evidence ledger

**Repository:** `ranoli90/x-relay-studio`  
**Audited baseline SHA:** `91246807628cf16392d6e661c98c31f254e77617` (main, 2026-09-06)  
**Working branch:** `repair/telegram-operator-slice`  
**Mode:** Isolated sandbox. Fake transport and harmless fixtures only. No live Telegram sends, invoices, production migrations, or paid probes. Production remains unchanged.

## Outcome labels

- **source-fixed** — code and targeted tests exist; live provider / Postgres concurrency may still be NOT RUN
- **runtime-verified** — executed against the running app / isolated tests
- **blocked** — cannot execute here
- **not run**
- **open**

## Workspace

| Item | Status | Notes |
|---|---|---|
| Workspace SHA | `9124680` | Matches the 2026-09-06 evidence baseline on main. |
| Branch | `repair/telegram-operator-slice` | Additive. Does not merge unrelated Reddit work. |
| Next migration | `0034_operator_telegram.sql` | Additive. Rollback: stop using the new tables and set `processing_permission=false`. |
| Deployment | unchanged | No production deploy from this wave. |

## Findings

| Finding | Priority | Disposition | Integrated path | Evidence |
|---|---|---|---|---|
| TG-12 stale-object revalidation | P0 | source-fixed | `revalidateForSend` in `src/lib/operator/state.ts`; `tryDispatchAutoSend` loads a **fresh** `loadLiveFinalState` object before MTProto; `agentSendToPeer` does the same at the transport boundary. Passing the same object twice is rejected. | `src/lib/operator/operator.test.ts` “TG-12 stale object is not revalidation” |
| TG-14 stop/takeover/opt-out/permission during hang | P0 | source-fixed | Fake transport hang in the operator kernel; live flags are re-read after the hang; canceled, not confirmed. Dispatch maps a post-send permission change to **uncertain** (not confirmed, not retryable fail). | operator.test.ts “TG-14 … during blocked transport” |
| TG-15 no duplicate after uncertain | P0 | source-fixed | `canRetryAttempt` blocks `uncertain` until `reconcileUncertain`. Commit path stores `uncertain` rather than `sent`. | operator.test.ts “TG-15 no duplicate send after uncertain” |
| Truthful controls / status | P0 | source-fixed | Settings switches call real server functions. Message ticks use `publicSendLabel` (`Draft — not sent`, `Approved — not sent`, `Not confirmed`, …). Auto-send / watching / processing permission / Stop are distinct. | `src/components/telegram/settings.tsx`, `conversation.tsx` |
| Visibility-aware unread | P0 | source-fixed | `listMessages` no longer calls `markChatRead`. Selecting a chat does not zero unread. Replica no longer auto-opens the first chat. Ack only when the conversation pane is visible and the document is visible. Sync does not treat “open” as read; a stored ack wins only if it is at least as new as `last_at`. | operator.test.ts “visibility-aware unread”; `store.ts` `ackVisibleChat`; `watch.server.ts` |
| Business vertical slice | P0 | source-fixed | Brief → structured draft → publish revision → `planningCatalog(published)` is the only catalog `processInbound` uses. Empty unpublished = no SKUs (no `DEFAULT_CATALOG` seed on live desks). Fractional `$12.50` = 1250 minor USD survives every layer. | operator.test.ts “business configuration vertical slice”; `persist.server.ts` `publishBusinessFromBrief` / `catalogForPlanning`; Business tab |
| Workspace credits vs customer quotes | P0 | source-fixed | Public payment view has copy + destination handle only. Credentials stay in `payment_credentials.envelope`. `evaluatePaymentEvidence` rejects wrong currency / destination. `mixesCreditWithCustomer` is explicit. No generic webhook “verified” checkbox. | operator.test.ts “payments stay separate…” |
| Incoming attachments + library | P0 | source-fixed | Typed `IncomingAttachment` (caption may be null). Library assets have approval states. Propose → `approved_not_sent`. Missing/revoked cannot send. Copy never claims a live human. | operator.test.ts “media pipeline”; Media tab |
| History / drafts / ingest fairness | P1 | source-fixed | Local notes filtered **before** the history limit (`confirmedTranscriptLimited`). Composer drafts persist in `composer_drafts`. Ingest batch = 4, oldest-attempt first; `preferChatIds` is passed into `pullInbox`. Provider timestamps stored on `provider_at`. | operator.test.ts “drafts, history, ingest fairness”; conversation.test.ts history limit |
| Shell consolidation | P1 | source-fixed | Inbox / Business / Media / Settings in the existing Telegram replica. Conversation sheet holds customer details, takeover, opt-out, assistant context. Simulator / Agents floor is Diagnostics, shown only when `XRELAY_ALLOW_SIMULATOR=isolated-fixture`. | `replica-shell.tsx`, `operator-nav.tsx` |
| Isolated fixtures | P1 | source-fixed | `seedIsolatedPreview` runs only when fixtures are allowed. Benign `$12.50` pack, captionless incoming still, unread Alex thread. No production chats copied. | `src/lib/operator/fixtures.ts` |
| XR-048 live Telegram→external-AI | P0 | blocked | Not authorized by this handoff. Processing permission defaults **false**. Preview / unlinked / no session stay `not_live`. | — |

## What was not tested

- Live Telegram, live OpenRouter/xAI, real invoices, production Neon apply of `0034`
- Two-worker PostgreSQL races on `send_attempts`
- Browser E2E of every mobile width against a logged-in desk (preview smoke covers render)
- Independent naturalness review of assistant copy

## Remaining risks

- Existing production personas get `processing_permission=false` after `0034`. Auto-send stays off until an operator turns Processing permission **and** Auto-send on. That is intentional.
- Post-send permission change after MTProto already acknowledged is recorded **uncertain**. The bytes may already be on Telegram; retry is blocked until reconcile. Do not treat HTTP success as sent.
- Fair ingest rotates stored chats. A brand-new live dialog that is not yet in `telegram_chats` waits until the dialog list upserts it.
- `listMessages` still returns at most 200 rows; older history is not loaded on scroll in this wave.

## Rollout

1. Merge the branch. Do **not** auto-deploy.
2. Apply `0034_operator_telegram.sql` on an isolated database first.
3. Confirm processing permission is off, then enable per desk.
4. Keep `XRELAY_ALLOW_SIMULATOR` unset in production.

## Rollback

Revert `repair/telegram-operator-slice` to `9124680`. Migration `0034` is additive (`if not exists`). Rollback in place: `update agent_personas set processing_permission=false, auto_send=false, automation_mode='draft'`. Stop using the new operator tables.
