-- Operator → us thread credits. Never mix with agent_payments (fan → operator).
-- PR #7 owns 0019; this must stay 0020.

alter table agent_threads
  add column if not exists billed_at timestamptz;

create table if not exists desk_billing (
  user_id text primary key,
  personas_cap integer not null default 1,
  paid_cycles integer not null default 0,
  lifetime_cents integer not null default 0,
  first_paid_at timestamptz,
  follow_discount_used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists desk_credit_lots (
  id text primary key,
  user_id text not null,
  kind text not null check (kind in ('refill', 'topup')),
  threads_original integer not null check (threads_original > 0),
  threads_remaining integer not null check (threads_remaining >= 0),
  expires_at timestamptz,
  invoice_id text,
  created_at timestamptz not null default now()
);
create index if not exists desk_credit_lots_user_idx
  on desk_credit_lots (user_id, kind, expires_at);

create table if not exists desk_invoices (
  id text primary key,
  user_id text not null,
  rail text not null check (rail in ('cryptobot', 'plisio')),
  sku text not null,
  threads integer not null check (threads > 0),
  amount_cents integer not null check (amount_cents > 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'underpay', 'cancelled')),
  external_id text,
  payload text not null default '{}',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  expires_at timestamptz
);
create unique index if not exists desk_invoices_ext_idx
  on desk_invoices (rail, external_id)
  where external_id is not null;
create index if not exists desk_invoices_user_idx
  on desk_invoices (user_id, created_at desc);

create table if not exists desk_webhook_events (
  id text primary key,
  rail text not null,
  external_id text not null,
  invoice_id text,
  raw_sha256 text not null,
  accepted boolean not null default false,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists desk_webhook_events_ext_idx
  on desk_webhook_events (rail, external_id);

create table if not exists desk_follows (
  user_id text not null,
  network text not null check (network in ('telegram', 'discord')),
  external_id text not null,
  verified_at timestamptz,
  last_check_at timestamptz,
  primary key (user_id, network)
);
create unique index if not exists desk_follows_ext_idx
  on desk_follows (network, external_id);
