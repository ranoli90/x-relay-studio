# ADR: Telegram transport, processing, consent, and payment

Status: accepted for the isolated repair branch. Not a legal opinion.

Date: 2026-09-08
Baseline: `2e16ef71c29606b756f937297de2e5dc38eff2e0`
Branch: `repair/telegram-assistant-kernel`

## Decision

Keep the existing user MTProto path as the authorized Telegram transport for this product. Do not treat a Business Bot as a workaround for user-account restrictions. A Business Bot remains a documented option with its own rights and reply windows; it is not implemented as a live path in this repair.

Customer-data processing is off until the desk owner grants **processing permission**. Owner login is not consent from correspondents. Customer opt-out, takeover, emergency stop, and a disconnected or generation-bumped account all win over a desired auto-reply switch.

Public payment copy may appear in a reply. Private credentials, envelopes, and webhook secrets never do. Customer settlements bind to an immutable quote (amount, currency, destination, processor account, provider event). Operator attestation and screenshots are evidence candidates, not provider confirmation. Workspace credits are a separate ledger.

Isolated fixtures (`XRELAY_ALLOW_SIMULATOR=isolated-fixture`) may publish `isolated=true` revisions. Those rows never become a live catalog.

## Consequences

- Automatic replies require processing permission, published offers, a capable writer (not key presence), a live account, and a fresh FinalState load after the transport lease.
- Live checks against real Telegram, paid processors, and production databases remain NOT_RUN without distinct owner authorization.
