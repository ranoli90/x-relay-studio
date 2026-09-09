# Follow-up repair after `1d7b94b`

Branch work against the 33 remaining findings in `X_Relay_Followup_Review_1d7b94b`. Original XR identifiers are preserved in the package reconciliation; this file records current dispositions.

| ID | Disposition | Layer |
|---|---|---|
| RF-001 | SOURCE_FIXED: `applyLiveArmSql` no longer writes `processing_permission=true`. Ingest no longer re-arms on every claim. New desks still default on. | UNIT_VERIFIED |
| RF-002 | SOURCE_FIXED: `inventedPrice` compares amount and currency. | UNIT_VERIFIED |
| RF-003 | SOURCE_FIXED: `$1,250` parses as 125000 minor; `€12,50` and `EUR 1.250,00` supported. | UNIT_VERIFIED |
| RF-004 | IMPROVED: publish keeps brief-derived voice/boundaries instead of wiping them. Writer still uses persona bible for tone. | SOURCE_FIXED_PARTIAL |
| RF-005 | IMPROVED: catalog rail is the public destination handle, never `manual_handle`. | SOURCE_FIXED_PARTIAL |
| RF-006 | SOURCE_FIXED: publishing revokes previous destinations; reads ignore `revoked_at`. | UNIT_NOT_DB_RACE |
| RF-007 | OPEN: quote id still not the payable offer identity. | SOURCE_REMAINING |
| RF-008 | SOURCE_FIXED: clause-scoped product refs. | UNIT_VERIFIED |
| RF-009 | SOURCE_FIXED: photo aliases only on photo items; generic ties return null. | UNIT_VERIFIED |
| RF-010 | SOURCE_FIXED: yes to method is not a payment claim; yes to offer keeps SKU; no thanks is W5. | UNIT_VERIFIED |
| RF-011 | SOURCE_FIXED: menu plans `catalog_menu`. Local fallback lists published titles and prices. | UNIT_VERIFIED |
| RF-012 | SOURCE_FIXED: local understand templates stay `local_template`; only exact `local/service-notice` is an approved notice. Prefix matches like `local/service-notice-extra` stay local. | UNIT_VERIFIED |
| RF-013 | SOURCE_FIXED: new asserted facts supersede other active values in one statement; unique index keeps one active predicate. Denials retract. | UNIT_VERIFIED |
| RF-014 | SOURCE_FIXED: history SQL filters confirmed rows before the limit. | SOURCE_FIXED |
| RF-015 | OPEN: generation snapshot still recaptured at dispatch. | SOURCE_REMAINING |
| RF-016 | OPEN: thread generation vs session generation. | SOURCE_REMAINING |
| RF-017 | SOURCE_FIXED: fan/thread insert uses `ON CONFLICT`, not recovery SELECTs in an aborted transaction. | SOURCE_FIXED |
| RF-018 | SOURCE_FIXED: claim owner + expiry + fenced finalize. Expired processing rows are reclaimable. | SOURCE_FIXED |
| RF-019 | OPEN: burst still per-row. | SOURCE_REMAINING |
| RF-020 | OPEN: held generation still completes ingress. | SOURCE_REMAINING |
| RF-021 | IMPROVED: partial commits no longer count as fully automatic. | SOURCE_FIXED_PARTIAL |
| RF-022 | SOURCE_FIXED: check-ins only after a fully sent reply. | SOURCE_FIXED |
| RF-023 | OPEN: draft CAS. | SOURCE_REMAINING |
| RF-024 | OPEN: unread last-seen id. | SOURCE_REMAINING |
| RF-025 | OPEN: media pipeline. | SOURCE_REMAINING |
| RF-026 | SOURCE_FIXED: empty live defaults, load/error states, delayed load does not overwrite typing. | SOURCE_FIXED |
| RF-027 | OPEN: eligibility collection UI. | SOURCE_REMAINING |
| RF-028 | IMPROVED: demo isolation; not a full authenticated mobile E2E. | SOURCE_FIXED_PARTIAL |
| RF-029 | SOURCE_FIXED: demo drops inherited `DATABASE_URL` unless `XRELAY_DEMO_DATABASE_URL` is set; production-looking URLs, including `prod-` hosts, exit. | UNIT_VERIFIED |
| RF-030 | IMPROVED: this file keeps original RF ids. Repo XR ledger not rewritten. | SOURCE_FIXED_PARTIAL |
| RF-031 | SOURCE_FIXED: seat increment and reservation insert are one CTE. | SOURCE_FIXED |
| RF-032 | SOURCE_FIXED: 0035/0038 dedupe before unique indexes; one active fact per predicate. Live production duplicate preflight still NOT_RUN. | SOURCE_FIXED |
| RF-033 | IMPROVED: uncertain sends keep the provider message id so later reconcile can find the transmission. Full recovery path remains open. | SOURCE_FIXED_PARTIAL |

Commands: `node --experimental-strip-types --test src/lib/operator/followup.test.ts` plus operator/agent/conversation/telegram suites. Typecheck `tsc --noEmit`. Authenticated browser, live Telegram, and PostgreSQL races remain NOT_RUN.
