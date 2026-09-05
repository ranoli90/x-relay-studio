create table if not exists desks (
  user_id text primary key,
  desk_number text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists desks_number_idx on desks (desk_number);
