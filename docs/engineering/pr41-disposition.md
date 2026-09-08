# PR #41 disposition

Reviewed draft: `0974a068bb48b967f3653d6d26c7a60336a2babb` (`repair/telegram-operator-slice`).

PR #41 is useful reference. It is **not** merged wholesale.

## Taken

- Operator UI shell: Inbox / Business / Media / Settings, later Activity.
- Visibility-aware unread, composer drafts, fake-transport kernel tests.
- Exact Money type, published-revision projection, payment public view.
- Isolated fixtures and media proposal statuses.

## Rejected or rewritten

- Silent `.catch(() => [])` schema fallbacks. Production persist is fail-closed.
- Fixture SQL that wrote `last_preview` into `provider_last_at` (`$5` reused).
- `processingPermission: true` captured defaults. Permission defaults off.
- Same-object `preSendFence(opts)` called twice and treated as revalidation.
- Planning catalog that dropped currency and invented an `operator` rail.
- Non-atomic publish without `service_key` / `isolated`.
- Isolated sample offers becoming live catalog items.
- Wholesale UI merge over current main Telegram replica behavior.

## Migration

`migrations/0034_operator_telegram.sql` is additive. Rollback is: stop using the new tables, set `processing_permission=false` and `desired_auto_reply=false`. Do not re-enable auto-send by rolling code back onto a stopped desk.
