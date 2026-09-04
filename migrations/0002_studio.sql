-- Studio: posting accounts, assigned sources, synced posts, rewrites.

create table if not exists publishers (
  id            text primary key,
  user_id       text not null,
  handle        text not null,
  name          text not null,
  avatar        text,
  banner        text,
  bio           text,
  x_user_id     text,
  source        text not null default 'handle',
  kit           jsonb,
  created_at    timestamptz not null default now()
);

create unique index if not exists publishers_user_handle_idx
  on publishers (user_id, lower(handle));
create index if not exists publishers_user_idx on publishers (user_id);

create table if not exists sources (
  id              text primary key,
  user_id         text not null,
  publisher_id    text not null,
  handle          text not null,
  name            text not null,
  avatar          text,
  banner          text,
  bio             text,
  followers       integer not null default 0,
  tweets_claimed  integer not null default 0,
  tweets_synced   integer not null default 0,
  media_synced    integer not null default 0,
  rewritten       integer not null default 0,
  status          text not null default 'pending',
  stage           text,
  error           text,
  voice           jsonb,
  oldest_at       timestamptz,
  newest_at       timestamptz,
  empty_windows   integer not null default 0,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now()
);

create unique index if not exists sources_publisher_handle_idx
  on sources (publisher_id, lower(handle));
create index if not exists sources_user_pub_idx on sources (user_id, publisher_id);
create index if not exists sources_status_idx on sources (user_id, status);

create table if not exists posts (
  id              text primary key,
  user_id         text not null,
  source_id       text not null,
  tweet_id        text not null,
  url             text,
  text            text not null default '',
  created_at      timestamptz,
  metrics         jsonb,
  media           jsonb,
  is_reply        boolean not null default false,
  is_retweet      boolean not null default false,
  is_quote        boolean not null default false,
  rewrite_text    text,
  rewrite_status  text not null default 'pending',
  stored_at       timestamptz not null default now()
);

create unique index if not exists posts_source_tweet_idx on posts (source_id, tweet_id);
create index if not exists posts_source_created_idx on posts (source_id, created_at desc);
create index if not exists posts_rewrite_idx on posts (source_id, rewrite_status);
