-- Resume + background monitor: never wipe a scrape; keep walking from the
-- oldest stored post toward the account's first post, then catch new ones.

alter table sources add column if not exists backfill_done boolean not null default false;
alter table sources add column if not exists windows_run integer not null default 0;

update sources set backfill_done = true where status = 'ready';
