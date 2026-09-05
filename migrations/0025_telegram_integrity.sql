-- Telegram integrity: last-success vs last-attempt, peer kind for private access hashes.
-- Additive. Do not edit 0001–0023.

alter table telegram_user_sessions
  add column if not exists last_sync_ok_at timestamptz;

alter table telegram_chats
  add column if not exists peer_kind text;

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = current_schema() and table_name = 'telegram_send_intents'
  ) then
    execute $idx$
      create unique index if not exists telegram_send_intents_inflight_uidx
        on telegram_send_intents (user_id, chat_id, body_sha256)
        where status in ('pending', 'uncertain')
    $idx$;
  end if;
end $$;
