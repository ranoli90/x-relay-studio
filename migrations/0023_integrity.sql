-- Integrity: unique settlements, webhook retry, lease owners, send intents.
-- Additive. Do not edit 0020/0022.

create unique index if not exists desk_credit_lots_invoice_uidx
  on desk_credit_lots (invoice_id)
  where invoice_id is not null;

alter table desk_webhook_events
  add column if not exists status text not null default 'received';

drop index if exists desk_webhook_events_ext_idx;
create unique index if not exists desk_webhook_events_sha_idx
  on desk_webhook_events (rail, raw_sha256);

alter table desk_invoices drop constraint if exists desk_invoices_status_check;
alter table desk_invoices
  add constraint desk_invoices_status_check
  check (status in ('creating', 'pending', 'uncertain', 'paid', 'expired', 'underpay', 'cancelled'));

create unique index if not exists agent_payments_offer_uidx
  on agent_payments (offer_id);

alter table telegram_user_sessions
  add column if not exists lease_owner text;
alter table telegram_user_sessions
  add column if not exists account_generation integer not null default 1;

create table if not exists telegram_send_intents (
  id text primary key,
  user_id text not null,
  chat_id text not null,
  peer_id text not null,
  body_sha256 text not null,
  body text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'uncertain', 'failed')),
  telegram_message_id text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists telegram_send_intents_user_idx
  on telegram_send_intents (user_id, created_at desc);

create table if not exists app_leases (
  name text primary key,
  owner text,
  until timestamptz
);
