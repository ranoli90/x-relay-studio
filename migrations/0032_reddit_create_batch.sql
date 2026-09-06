-- Queue 1–5 Reddit account creates on one desk.
-- One live job at a time so reddit_onboarding_jobs_one_active_uidx stays.
-- Remaining slots live on the batch row, not as extra unfinished jobs.

alter table reddit_onboarding_jobs
  add column if not exists batch_id text,
  add column if not exists batch_size integer not null default 1,
  add column if not exists batch_index integer not null default 1;

create table if not exists reddit_onboarding_batches (
  id text primary key,
  user_id text not null,
  size integer not null,
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  cancelled_count integer not null default 0,
  status text not null,
  current_job_id text,
  current_index integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reddit_onboarding_batches_size_chk check (size >= 1 and size <= 5)
);
create index if not exists reddit_onboarding_batches_user_idx
  on reddit_onboarding_batches (user_id, updated_at desc);
create unique index if not exists reddit_onboarding_batches_one_open_uidx
  on reddit_onboarding_batches (user_id)
  where status in ('queued', 'running');
