-- Telegram door: linked identity + Path A replica (studio notes / bot-visible chats).
-- Path B (MTProto) session material is never stored here.

create table if not exists telegram_accounts (
  user_id            text primary key,
  telegram_user_id   bigint not null unique,
  username           text,
  first_name         text not null,
  last_name          text,
  photo_url          text,
  auth_date          timestamptz,
  path               text not null check (path in ('oidc', 'mtproto')),
  bot_can_write      boolean not null default false,
  preview            boolean not null default false,
  replica_first_name text,
  replica_last_name  text,
  replica_about      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_seen_at       timestamptz
);

create index if not exists telegram_accounts_tg_id_idx
  on telegram_accounts (telegram_user_id);

create table if not exists telegram_chats (
  id            text primary key,
  user_id       text not null references telegram_accounts (user_id) on delete cascade,
  kind          text not null check (kind in ('notes', 'bot', 'user')),
  title         text not null,
  photo_url     text,
  last_preview  text,
  last_at       timestamptz,
  unread        integer not null default 0,
  pinned        boolean not null default false,
  muted         boolean not null default false,
  peer_id       text,
  created_at    timestamptz not null default now()
);

create index if not exists telegram_chats_user_idx
  on telegram_chats (user_id, pinned desc, last_at desc);

create table if not exists telegram_messages (
  id            text primary key,
  user_id       text not null,
  chat_id       text not null references telegram_chats (id) on delete cascade,
  from_self     boolean not null default false,
  author_name   text not null,
  body          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists telegram_messages_chat_idx
  on telegram_messages (user_id, chat_id, created_at);

create table if not exists telegram_oidc_tickets (
  state       text primary key,
  user_id     text not null,
  nonce       text not null,
  verifier    text not null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);

create index if not exists telegram_oidc_tickets_user_idx
  on telegram_oidc_tickets (user_id, created_at desc);

create table if not exists telegram_rate_events (
  user_id  text not null,
  kind     text not null,
  at       timestamptz not null default now()
);

create index if not exists telegram_rate_events_idx
  on telegram_rate_events (user_id, kind, at desc);
