-- Operator Telegram slice: business, payments, media, send attempts, drafts, read acks.
-- Additive. Rollback: stop using the tables and set processing_permission=false.

alter table agent_personas
  add column if not exists permission_revision integer not null default 1;
alter table agent_personas
  add column if not exists processing_permission boolean not null default false;
alter table agent_personas
  add column if not exists ai_disclosed boolean not null default true;

alter table telegram_chats
  add column if not exists provider_last_at timestamptz;
alter table telegram_messages
  add column if not exists provider_at timestamptz;
alter table telegram_messages
  add column if not exists origin text;
alter table telegram_messages
  add column if not exists send_status text;

create table if not exists operator_bindings (
  id text primary key,
  user_id text not null,
  telegram_account_id text not null,
  creator_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, telegram_account_id)
);

create table if not exists business_briefs (
  id text primary key,
  user_id text not null,
  binding_id text not null,
  plain_text text not null,
  created_at timestamptz not null default now()
);

create table if not exists business_revisions (
  id text primary key,
  user_id text not null,
  binding_id text not null,
  brief_id text not null,
  revision integer not null,
  status text not null,
  structured_json text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (binding_id, revision)
);

create table if not exists business_offers (
  id text primary key,
  user_id text not null,
  binding_id text not null,
  revision_id text not null,
  title text not null,
  amount_minor integer not null,
  currency text not null,
  available boolean not null default true,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists business_offers_binding_idx
  on business_offers (user_id, binding_id, status);

create table if not exists payment_instructions (
  id text primary key,
  user_id text not null,
  binding_id text not null,
  revision_id text not null,
  public_copy text not null,
  currency text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists payment_destinations (
  id text primary key,
  user_id text not null,
  binding_id text not null,
  provider text not null,
  destination_ref text not null,
  currency text not null,
  credential_id text,
  created_at timestamptz not null default now()
);

create table if not exists payment_credentials (
  id text primary key,
  user_id text not null,
  destination_id text not null,
  envelope text not null,
  created_at timestamptz not null default now()
);

create table if not exists payment_evidence (
  id text primary key,
  user_id text not null,
  offer_id text not null,
  amount_minor integer not null,
  currency text not null,
  destination_id text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists media_assets (
  id text primary key,
  user_id text not null,
  binding_id text not null,
  kind text not null,
  title text not null,
  mime text not null,
  byte_size integer not null,
  storage_key text not null,
  approval text not null,
  proves_live_human boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists incoming_attachments (
  id text primary key,
  user_id text not null,
  conversation_id text not null,
  kind text not null,
  caption text,
  provider_media_id text not null,
  bytes_available boolean not null default true,
  provider_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists media_proposals (
  id text primary key,
  user_id text not null,
  conversation_id text not null,
  asset_id text not null,
  status text not null,
  send_attempt_id text,
  created_at timestamptz not null default now()
);

create table if not exists composer_drafts (
  user_id text not null,
  conversation_id text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create table if not exists conversation_read_acks (
  user_id text not null,
  conversation_id text not null,
  last_visible_at timestamptz not null,
  primary key (user_id, conversation_id)
);

create table if not exists send_attempts (
  id text primary key,
  user_id text not null,
  conversation_id text not null,
  body text not null,
  status text not null,
  captured_json text not null,
  live_json text,
  transport_message_id text,
  uncertain_reason text,
  reconciled_as text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists send_attempts_conv_idx
  on send_attempts (user_id, conversation_id, created_at desc);

create table if not exists ingest_cursors (
  user_id text not null,
  conversation_id text not null,
  last_provider_at timestamptz,
  last_attempt_at timestamptz,
  next_eligible_at timestamptz,
  error_count integer not null default 0,
  primary key (user_id, conversation_id)
);
