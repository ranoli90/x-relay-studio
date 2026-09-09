# Follow-up repair after `1d7b94b`

Branch work against the 33 remaining findings in `X_Relay_Followup_Review_1d7b94b`. Original XR identifiers are preserved in the package reconciliation; this file records current dispositions.

| ID | Disposition | Layer |
|---|---|---|
| RF-001 | SOURCE_FIXED: `applyLiveArmSql` no longer writes `processing_permission=true`. Ingest no longer re-arms on every claim. New desks still default on. | UNIT_VERIFIED |
| RF-002 | SOURCE_FIXED: `inventedPrice` compares amount and currency. | UNIT_VERIFIED |
| RF-003 | SOURCE_FIXED: `$1,250` parses as 125000 minor; `€12,50` and `EUR 1.250,00` supported. | UNIT_VERIFIED |
| RF-004 | SOURCE_FIXED: publish keeps brief-derived voice/boundaries; the business pane edits them; writer system prompt uses approved name/about/boundaries. | UNIT_VERIFIED |
| RF-005 | SOURCE_FIXED: catalog rail is the public destination handle, never `manual_handle`. Unpublished-rail local notices use published payment copy. | UNIT_VERIFIED |
| RF-006 | SOURCE_FIXED: publishing revokes previous destinations; reads ignore `revoked_at`. | UNIT_NOT_DB_RACE |
| RF-007 | SOURCE_FIXED: `quoteView` requires the operator quote id; `agent_offers.id` and `quote_id` are that id; writer prompt repeats `id=`. | UNIT_VERIFIED |
| RF-008 | SOURCE_FIXED: clause-scoped product refs. | UNIT_VERIFIED |
| RF-009 | SOURCE_FIXED: photo aliases only on photo items; generic ties return null. | UNIT_VERIFIED |
| RF-010 | SOURCE_FIXED: yes to method is not a payment claim; yes to offer keeps SKU; no thanks is W5. | UNIT_VERIFIED |
| RF-011 | SOURCE_FIXED: menu plans `catalog_menu`. Local fallback lists published titles and prices. | UNIT_VERIFIED |
| RF-012 | SOURCE_FIXED: local understand templates stay `local_template`; only exact `local/service-notice` is an approved notice. Prefix matches like `local/service-notice-extra` stay local. | UNIT_VERIFIED |
| RF-013 | SOURCE_FIXED: new asserted facts supersede other active values in one statement; unique index keeps one active predicate. Denials retract. | UNIT_VERIFIED |
| RF-014 | SOURCE_FIXED: history SQL filters confirmed rows before the limit. | SOURCE_FIXED |
| RF-015 | SOURCE_FIXED: `processInbound` and check-in capture `FinalState` before write; dispatch and MTProto send the captured snapshot, not a recapture. | UNIT_VERIFIED |
| RF-016 | SOURCE_FIXED: session `account_generation` is authoritative; thread generation is stamped from the session; send rejects stale session generation and telegram account. | UNIT_VERIFIED |
| RF-017 | SOURCE_FIXED: fan/thread insert uses `ON CONFLICT`, not recovery SELECTs in an aborted transaction. | SOURCE_FIXED |
| RF-018 | SOURCE_FIXED: claim owner + expiry + fenced finalize. Expired processing rows are reclaimable. | SOURCE_FIXED |
| RF-019 | SOURCE_FIXED: quiet/max burst windows coalesce sibling bodies into one generation under the oldest message id; a foreign in-flight claim yields the burst. Two-worker race still NOT_RUN. | UNIT_VERIFIED |
| RF-020 | SOURCE_FIXED: `generation_failed` / empty / timeout drops skip idempotency complete, expire the lease, and return ingress to `retry_wait`. Safety/handoff drops stay held. Live provider loop still NOT_RUN. | UNIT_VERIFIED |
| RF-021 | SOURCE_FIXED: `last_outbound_at` and check-in jobs only move on a fully sent, non-partial auto reply. | SOURCE_FIXED |
| RF-022 | SOURCE_FIXED: check-ins only after a fully sent reply. | SOURCE_FIXED |
| RF-023 | SOURCE_FIXED: composer drafts version-CAS; a draft typed during send is kept on success; CAS failure does not adopt a stale version. Two-tab race NOT_RUN. | UNIT_VERIFIED |
| RF-024 | SOURCE_FIXED: unread ack requires the last rendered inbound id; later inbound stays unread. | UNIT_VERIFIED |
| RF-025 | SOURCE_FIXED_PARTIAL: upload → pending → approve/revoke → propose; isolated fixtures may send a fake receipt. Live MTProto photo send returns `media_transport_not_live`. | UNIT_VERIFIED |
| RF-026 | SOURCE_FIXED: empty live defaults, load/error states, delayed load does not overwrite typing. | SOURCE_FIXED |
| RF-027 | SOURCE_FIXED: conversation sheet collects evidence before allowed/disallowed; unknown stays held; opening a chat never auto-marks allowed. | UNIT_VERIFIED |
| RF-028 | IMPROVED: demo isolation; not a full authenticated mobile E2E. | SOURCE_FIXED_PARTIAL |
| RF-029 | SOURCE_FIXED: demo drops inherited `DATABASE_URL` unless `XRELAY_DEMO_DATABASE_URL` is set; production-looking URLs, including `prod-` hosts, exit. | UNIT_VERIFIED |
| RF-030 | IMPROVED: this file keeps original RF ids. Repo XR ledger not rewritten. | SOURCE_FIXED_PARTIAL |
| RF-031 | SOURCE_FIXED: seat increment and reservation insert are one CTE. | SOURCE_FIXED |
| RF-032 | SOURCE_FIXED: 0035/0038 dedupe before unique indexes; one active fact per predicate. Live production duplicate preflight still NOT_RUN. | SOURCE_FIXED |
| RF-033 | SOURCE_FIXED: a miss in provider history stays uncertain (not failed); provider message id is kept; retry is blocked until positive evidence. | UNIT_VERIFIED |

Commands: `node --experimental-strip-types --test src/lib/operator/followup.test.ts src/lib/operator/operator.test.ts src/lib/agent/write.test.ts src/lib/conversation/conversation.test.ts` plus agent/telegram suites. Typecheck `tsc --noEmit`. Authenticated browser, live Telegram photo send, and PostgreSQL two-worker races remain NOT_RUN.
