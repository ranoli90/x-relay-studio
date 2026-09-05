alter table reddit_apps add column if not exists app_label text;
alter table reddit_apps add column if not exists app_id text;
alter table reddit_apps add column if not exists terms_at timestamptz;
