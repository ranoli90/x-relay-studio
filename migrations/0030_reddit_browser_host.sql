-- Per-desk Steel Cloud (or other hosted browser) credentials.
-- Encrypted at rest. Never log or return the plaintext key.

create table if not exists reddit_browser_hosts (
  user_id text primary key,
  provider text not null,
  api_base_url text not null,
  api_key_ciphertext text not null,
  key_hint text not null,
  status text not null,
  last_verified_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reddit_browser_hosts_status_idx
  on reddit_browser_hosts (status, updated_at);
