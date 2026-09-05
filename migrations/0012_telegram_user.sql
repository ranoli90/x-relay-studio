-- Path B: the user's real Telegram (MTProto). Encrypted session + watch state.
-- Bot helper keys stay in telegram_credentials and are unused on this path.

create table if not exists telegram_user_sessions (
  user_id              text primary key,
  api_id               integer not null,
  api_hash_enc         text not null,
  phone                text not null,
  phone_code_hash_enc  text,
  session_enc          text,
  needs_password       boolean not null default false,
  watching             boolean not null default true,
  last_sync_at         timestamptz,
  last_error           text,
  chats_watched        integer not null default 0,
  messages_ingested    integer not null default 0,
  openrouter_key_enc   text,
  openrouter_ok_at     timestamptz,
  automation_armed     boolean not null default false,
  checks_json          text not null default '{}',
  onboarded_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table telegram_messages
  add column if not exists ai_status text not null default 'held';

create index if not exists telegram_messages_ai_idx
  on telegram_messages (user_id, ai_status, created_at)
  where ai_status = 'queued';
