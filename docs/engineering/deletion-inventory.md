# Operator derived-data deletion inventory

Disconnect (`telegramUnlinkFn`) wipes session material, then deletes every operator-derived row for that `user_id`. These tables cannot rehydrate a desk, catalog, quote, or correspondent memory after erase.

| Table | Why it is derived | Rehydrate after erase? |
|---|---|---|
| `memory_facts` | Tenant+customer asserted/inferred facts | No |
| `operator_quotes` | Immutable quoted amounts | No |
| `payment_evidence` | Attested screenshots / candidates | No |
| `payment_credentials` | Destination envelopes | No |
| `payment_destinations` | Public rails / handles | No |
| `payment_instructions` | Approved public copy | No |
| `media_proposals` | Approved-not-sent library proposals | No |
| `incoming_attachments` | Observed inbound media metadata | No |
| `media_assets` | Stored stills metadata | No |
| `composer_drafts` | Unsent composer bodies | No |
| `conversation_read_acks` | Visibility acks | No |
| `send_attempts` | Outbox / uncertain / confirmed | No |
| `ingest_cursors` | Fair-ingest cursors | No |
| `business_offers` | Published SKUs | No |
| `business_revisions` | Published structured business | No |
| `business_briefs` | Operator briefs | No |
| `operator_bindings` | Account binding | No |

Source of truth: `src/lib/operator/erase.ts` `OPERATOR_ERASE_TABLES`. `eraseOperatorDerivedData` runs the deletes in one transaction.

Live end-to-end deletion proof (row counts on a populated production desk) is **NOT_RUN** from this sandbox.
