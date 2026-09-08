# Findings ledger — current dispositions

Baseline still present on main `2e16ef71`. Repair is on `repair/telegram-assistant-kernel`. Layers: SOURCE_FIXED, UNIT_VERIFIED, DB_INTEGRATION_VERIFIED, BROWSER_VERIFIED, LIVE_VERIFIED, BLOCKED, NOT_RUN.

| ID | Title (short) | Disposition | Layer | Notes |
|---|---|---|---|---|
| XR-001 | Everyday nav incomplete | SOURCE_FIXED | UNIT_VERIFIED | Inbox, Business, Media, Activity, Settings |
| XR-002 | Desired vs effective auto-reply | SOURCE_FIXED | UNIT_VERIFIED | effective-state.ts + Settings pane |
| XR-003 | Live default catalog | SOURCE_FIXED | UNIT_VERIFIED | seed no longer inserts live SKUs; planning uses published revision |
| XR-004 | Exact money / currency | SOURCE_FIXED | UNIT_VERIFIED | operator/money.ts |
| XR-005 | Screenshot ≠ settlement | SOURCE_FIXED | UNIT_VERIFIED | provenance evidence_candidate; attestation_not_settlement |
| XR-006 | Keyword routing | SOURCE_FIXED | UNIT_VERIFIED | interpretMessage; catalog-only SKU |
| XR-007 | Yes vs pending question | SOURCE_FIXED | UNIT_VERIFIED | pendingQuestion on interpret + route |
| XR-008 | Direct question before pitch | SOURCE_FIXED | UNIT_VERIFIED | W6 answers published item; W5 no forced pitch |
| XR-009 | Memory override of truth | SOURCE_FIXED | NOT_RUN | writer policy + scoped facts; long-history DB tests remaining |
| XR-010 | Two same-named customers | SOURCE_FIXED | NOT_RUN | memory_facts tenant+customer scope; isolation test remaining |
| XR-011 | Silent truncation | SOURCE_FIXED | UNIT_VERIFIED | unusableFinish / healthIsReady already in generate.ts |
| XR-012 | Ingress uniqueness | IN_PROGRESS | NOT_RUN | existing idempotency; two-worker PG remaining |
| XR-013 | Stale send fence | SOURCE_FIXED | UNIT_VERIFIED | revalidateForSend rejects same object; lease rereads FinalState |
| XR-014 | Uncertain retry | SOURCE_FIXED | UNIT_VERIFIED | canRetryAttempt |
| XR-015 | Burst debounce | IN_PROGRESS | NOT_RUN | not fully proven under two-worker PG |
| XR-016 | Claim leases | IN_PROGRESS | NOT_RUN | existing claim path; crash tests remaining |
| XR-017 | Fair ingest | SOURCE_FIXED | UNIT_VERIFIED | nextIngestBatch |
| XR-018 | Permission defaults | SOURCE_FIXED | UNIT_VERIFIED | processing_permission default false |
| XR-019 | Provider timeout recovery | IN_PROGRESS | NOT_RUN | uncertain recorded; live recovery NOT_RUN |
| XR-020 | Stop aggregation | SOURCE_FIXED | UNIT_VERIFIED | persona OR session emergency_stop |
| XR-021 | Outbox aggregation | SOURCE_FIXED | UNIT_VERIFIED | send_attempts + Activity |
| XR-022 | Background without tab | SOURCE_FIXED | NOT_RUN | background_run already ticked; isolated only |
| XR-023 | Schema catch-and-fallback | SOURCE_FIXED | UNIT_VERIFIED | persist.server fail-closed; ingest fail-closed on permission |
| XR-024 | Coverage / SHA drift | SOURCE_FIXED | UNIT_VERIFIED | recorded in telegram-operator-ledger.md |
| XR-025 | Media bytes vs library | SOURCE_FIXED | UNIT_VERIFIED | proposals approved_not_sent; honest copy |
| XR-026 | Incoming attachments | SOURCE_FIXED | UNIT_VERIFIED | captionless allowed |
| XR-027 | Fulfillment evidence | IN_PROGRESS | NOT_RUN | deliveryAfterTransport; live transport NOT_RUN |
| XR-028 | Partial multi-bubble | IN_PROGRESS | NOT_RUN | commitBubbles already tracks partial |
| XR-029 | Quoted / negated product | SOURCE_FIXED | UNIT_VERIFIED | interpret tests |
| XR-030 | Atomic publish | SOURCE_FIXED | UNIT_VERIFIED | withTransaction + service_key |
| XR-031 | Writer untrusted context | SOURCE_FIXED | UNIT_VERIFIED | WRITER_UNTRUSTED_POLICY |
| XR-032 | Separate ledgers | SOURCE_FIXED | UNIT_VERIFIED | mixesCreditWithCustomer |
| XR-033 | Quote snapshot | SOURCE_FIXED | UNIT_VERIFIED | operator_quotes table + WriteInput.quoteSnapshot |
| XR-034 | Composer IME | SOURCE_FIXED | UNIT_VERIFIED | isComposing / keyCode 229 |
| XR-035 | Draft persistence | SOURCE_FIXED | UNIT_VERIFIED | composer_drafts |
| XR-036 | Unread ack | SOURCE_FIXED | UNIT_VERIFIED | visibility-aware |
| XR-037 | Business editor | SOURCE_FIXED | NOT_RUN | Business pane; authenticated browser remaining |
| XR-038 | Media pane | SOURCE_FIXED | NOT_RUN | Media pane present; browser remaining |
| XR-039 | Context sheet | SOURCE_FIXED | NOT_RUN | ConversationSheet |
| XR-040 | Diagnostics out of primary | SOURCE_FIXED | UNIT_VERIFIED | lab only when fixtures allowed |
| XR-041 | Failure/empty states | SOURCE_FIXED | NOT_RUN | error banners; browser remaining |
| XR-042 | N+1 / pagination | IN_PROGRESS | NOT_RUN | ingest batch bounded; load tests remaining |
| XR-043 | CI build/E2E | SOURCE_FIXED | NOT_RUN | CI now typecheck+test+build; authenticated E2E remaining |
| XR-044 | Blinded naturalness | NOT_RUN | NOT_RUN | not a GOLD-score claim |
| XR-045 | Tenant isolation | SOURCE_FIXED | NOT_RUN | queries scoped by user_id; forged-webhook remaining |
| XR-046 | Prompt injection / uploads | IN_PROGRESS | UNIT_VERIFIED | safety refuse; upload tests remaining |
| XR-047 | PR41 review | SOURCE_FIXED | UNIT_VERIFIED | pr41-disposition.md |
| XR-048 | Deletion / retention | IN_PROGRESS | NOT_RUN | not proven end-to-end |
| XR-049 | Route capability | SOURCE_FIXED | UNIT_VERIFIED | healthIsReady |
| XR-050 | Isolated samples ≠ live | SOURCE_FIXED | UNIT_VERIFIED | isolated=true + filter |
| XR-051 | Fixture SQL last_at | SOURCE_FIXED | UNIT_VERIFIED | provider_last_at = $6 |
| XR-052 | Stable service identity | SOURCE_FIXED | UNIT_VERIFIED | service_key unique per revision |
| XR-053 | No inferred USD | SOURCE_FIXED | UNIT_VERIFIED | pay.ts currency_missing |
| XR-054 | Fractional $12.50 | SOURCE_FIXED | UNIT_VERIFIED | 1250 minor USD |
| XR-055 | Account generation fence | SOURCE_FIXED | UNIT_VERIFIED | revalidateForSend |
| XR-056 | Workspace vs customer pay | SOURCE_FIXED | UNIT_VERIFIED | separate kinds |
| XR-057 | Binding scope | SOURCE_FIXED | UNIT_VERIFIED | operator_bindings unique (user, account) |
| XR-058 | Platform ADR | SOURCE_FIXED | UNIT_VERIFIED | telegram-platform-adr.md |

Release-critical live integrations remain NOT_RUN. This branch is not production-ready.
