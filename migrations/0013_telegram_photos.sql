create table if not exists telegram_photos (
  user_id    text not null,
  peer_id    text not null,
  mime       text not null default 'image/jpeg',
  bytes      bytea not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);
