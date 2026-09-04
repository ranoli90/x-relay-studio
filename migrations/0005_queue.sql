-- Queue counters so the posting list does not rescan posts on every paint.

alter table sources add column if not exists rewrite_pending integer not null default 0;
alter table sources add column if not exists rewrite_skipped integer not null default 0;

update sources s set
  rewrite_pending = (select count(*) from posts p where p.source_id = s.id and p.rewrite_status = 'pending'),
  rewrite_skipped = (select count(*) from posts p where p.source_id = s.id and p.rewrite_status = 'skipped');
