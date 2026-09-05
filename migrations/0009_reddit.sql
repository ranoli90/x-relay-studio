-- One OAuth app per studio user. Accounts then Allow that app.
create table if not exists reddit_apps (
  user_id text primary key,
  client_id text not null,
  client_secret text not null,
  user_agent_name text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each row is one Reddit account connected to a studio user.
create table if not exists reddit_accounts (
  id text primary key,
  user_id text not null,
  reddit_id text not null,
  name text not null,
  icon_img text,
  created_utc bigint,
  has_verified_email boolean not null default false,
  is_gold boolean not null default false,
  is_mod boolean not null default false,
  is_suspended boolean not null default false,
  link_karma integer not null default 0,
  comment_karma integer not null default 0,
  total_karma integer not null default 0,
  refresh_token text not null,
  access_token text,
  access_expires_at timestamptz,
  scopes text not null,
  health_json text,
  health_ok boolean not null default false,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, reddit_id)
);
create index if not exists reddit_accounts_user_id_idx on reddit_accounts (user_id);

create table if not exists reddit_oauth_tickets (
  ticket text primary key,
  user_id text not null,
  state text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists reddit_oauth_tickets_user_idx on reddit_oauth_tickets (user_id);
