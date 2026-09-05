-- Freeze posture for Path B MTProto user sessions.
-- Persist Telegram flood / dead-key state across Vercel isolates so the
-- next request does not immediately retry a punished auth key.

alter table telegram_user_sessions
  add column if not exists flood_until timestamptz,
  add column if not exists auth_dead boolean not null default false,
  add column if not exists send_day_key date,
  add column if not exists send_day_count integer not null default 0,
  add column if not exists lease_until timestamptz;

alter table telegram_user_sessions
  alter column watching set default false;

alter table telegram_chats
  add column if not exists access_hash text;
