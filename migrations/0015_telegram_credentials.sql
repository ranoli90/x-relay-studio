-- Per-user Telegram helper keys (Bot API). Encrypted at rest. No session strings.
-- Renumbered from 0009_telegram_credentials.sql so prefixes stay unique.
-- Exists before telegram_accounts so onboarding can save a key first.

create table if not exists telegram_credentials (
  user_id            text primary key,
  bot_token_enc      text not null,
  bot_id             bigint,
  bot_username       text,
  bot_name           text,
  token_hint         text,
  start_payload      text,
  start_payload_exp  timestamptz,
  webhook_secret     text,
  webhook_active     boolean not null default false,
  last_update_id     bigint,
  hello_at           timestamptz,
  checks_json        text not null default '{}',
  onboarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists telegram_credentials_payload_idx
  on telegram_credentials (start_payload);

create index if not exists telegram_credentials_hook_idx
  on telegram_credentials (webhook_secret);
