alter table outbox add column if not exists retry_count integer not null default 0;
alter table outbox add column if not exists last_error text;
alter table outbox add column if not exists lease_until timestamptz;
create index if not exists outbox_lease_idx on outbox (status, lease_until, due_at);
drop index if exists outbox_watch_once_idx;
create unique index if not exists outbox_watch_kind_once_idx
  on outbox (publisher_id, watch_post_id, kind)
  where watch_post_id is not null;
