-- Search cursor is independent of stored oldest/newest so a duplicate
-- window still walks backward and never restarts the archive.

alter table sources add column if not exists cursor_until timestamptz;
