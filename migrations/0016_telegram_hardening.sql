-- Path A hardening: unique webhook secrets, local username, inbound message dedupe.
-- Renumbered from 0010_telegram_hardening.sql so prefixes stay unique.

alter table telegram_accounts
  add column if not exists replica_username text;

alter table telegram_messages
  add column if not exists telegram_message_id bigint;

alter table telegram_messages
  add column if not exists status text not null default 'sent';

create unique index if not exists telegram_messages_tg_id_idx
  on telegram_messages (user_id, chat_id, telegram_message_id)
  where telegram_message_id is not null;

create unique index if not exists telegram_credentials_hook_unique
  on telegram_credentials (webhook_secret)
  where webhook_secret is not null;
