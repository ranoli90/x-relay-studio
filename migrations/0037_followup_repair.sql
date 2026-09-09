-- Follow-up repair: ingress leases, destination revision binding, permission fencing.
-- Rollback: drop the new columns; do not re-grant processing_permission.

alter table telegram_messages
  add column if not exists claim_owner text,
  add column if not exists claim_expires_at timestamptz;

create index if not exists telegram_messages_claim_idx
  on telegram_messages (ai_status, claim_expires_at)
  where ai_status = 'processing';

alter table payment_destinations
  add column if not exists revision_id text,
  add column if not exists revoked_at timestamptz;

create index if not exists payment_destinations_active_idx
  on payment_destinations (user_id, binding_id, currency)
  where revoked_at is null;
