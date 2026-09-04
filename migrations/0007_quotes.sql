-- Quotes as a third outbox kind. Reply + quote can target the same watch post.
-- Starter watch is seeded in app code, not SQL.

alter table publishers add column if not exists last_quote_at timestamptz;

drop index if exists outbox_watch_once_idx;

create unique index if not exists outbox_watch_kind_once_idx
  on outbox (publisher_id, watch_post_id, kind)
  where watch_post_id is not null;
