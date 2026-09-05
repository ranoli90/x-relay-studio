-- Containment: job recovery columns; watching is not AI consent.
-- automation_armed (0017) remains the explicit processing-consent flag.

alter table agent_jobs
  add column if not exists status text not null default 'pending';
alter table agent_jobs
  add column if not exists attempt_count integer not null default 0;
alter table agent_jobs
  add column if not exists last_error text;
alter table agent_jobs
  add column if not exists claim_token text;
alter table agent_jobs
  add column if not exists claim_until timestamptz;

create index if not exists agent_jobs_retry_idx
  on agent_jobs (run_at)
  where done_at is null and status in ('pending', 'retry_wait');
