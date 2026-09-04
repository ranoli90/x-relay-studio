-- Universal 24/7 watch list (one per user, shared by every posting account)
-- plus a drip outbox: many originals + replies, not a single post.

alter table publishers add column if not exists drip_enabled boolean not null default true;
alter table publishers add column if not exists last_original_at timestamptz;
alter table publishers add column if not exists last_reply_at timestamptz;

create table if not exists watch_handles (
  id           text primary key,
  user_id      text not null,
  handle       text not null,
  name         text not null,
  avatar       text,
  enabled      boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

create unique index if not exists watch_handles_user_handle_idx
  on watch_handles (user_id, lower(handle));
create index if not exists watch_handles_user_idx on watch_handles (user_id);

create table if not exists watch_posts (
  id          text primary key,
  user_id     text not null,
  watch_id    text not null,
  tweet_id    text not null,
  url         text,
  handle      text not null,
  text        text not null default '',
  created_at  timestamptz,
  stored_at   timestamptz not null default now()
);

create unique index if not exists watch_posts_tweet_idx on watch_posts (watch_id, tweet_id);
create index if not exists watch_posts_user_created_idx on watch_posts (user_id, created_at desc);

create table if not exists outbox (
  id              text primary key,
  user_id         text not null,
  publisher_id    text not null,
  kind            text not null,
  status          text not null default 'due',
  body            text not null,
  media_url       text,
  reply_to_url    text,
  source_post_id  text,
  watch_post_id   text,
  due_at          timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists outbox_due_idx on outbox (user_id, publisher_id, status, due_at);
create unique index if not exists outbox_source_once_idx on outbox (publisher_id, source_post_id)
  where source_post_id is not null;
create unique index if not exists outbox_watch_once_idx on outbox (publisher_id, watch_post_id)
  where watch_post_id is not null;
