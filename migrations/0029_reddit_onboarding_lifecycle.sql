-- Additive lifecycle: allocation receipts, retained profiles, email bindings,
-- readiness evidence, and owner-reviewed drafts. Do not drop existing rows.

alter table reddit_oauth_tickets
  add column if not exists purpose text not null default 'connect_account',
  add column if not exists allowed_origin text,
  add column if not exists attempt_generation integer not null default 1,
  add column if not exists app_id text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists exchange_started_at timestamptz,
  add column if not exists exchange_completed_at timestamptz;

alter table reddit_cleanup_tasks
  add column if not exists lease_generation integer not null default 0,
  add column if not exists parent_task_id text,
  add column if not exists required boolean not null default true,
  add column if not exists summary_of_account_id text;

alter table reddit_onboarding_jobs
  add column if not exists allocation_status text not null default 'none',
  add column if not exists allocation_receipt_json text,
  add column if not exists provider_context_id text,
  add column if not exists handoff_from_mode text,
  add column if not exists retention_status text,
  add column if not exists retention_expires_at timestamptz;

alter table reddit_browser_profiles
  add column if not exists retention_requested boolean not null default false,
  add column if not exists retention_status text not null default 'temporary',
  add column if not exists retained_at timestamptz,
  add column if not exists consent_receipt_id text,
  add column if not exists workflow_version text,
  add column if not exists session_generation integer not null default 0,
  add column if not exists lease_owner text,
  add column if not exists lease_generation integer not null default 0,
  add column if not exists lease_until timestamptz,
  add column if not exists last_verified_username text,
  add column if not exists reddit_id text,
  add column if not exists deletion_state text not null default 'none',
  add column if not exists deletion_confirmed_at timestamptz,
  add column if not exists failure_code text;

create table if not exists reddit_allocation_intents (
  id text primary key,
  user_id text not null,
  job_id text not null,
  kind text not null,
  status text not null,
  provider text not null,
  request_fingerprint text not null,
  provider_context_id text,
  provider_session_id text,
  receipt_json text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists reddit_allocation_intents_fp_uidx
  on reddit_allocation_intents (user_id, job_id, kind, request_fingerprint);
create index if not exists reddit_allocation_intents_job_idx
  on reddit_allocation_intents (job_id, created_at);

create table if not exists reddit_email_bindings (
  id text primary key,
  user_id text not null,
  account_id text,
  kind text not null,
  provider text not null,
  provider_resource_ref text,
  address_ciphertext text,
  masked_display text not null,
  domain_evidence_ref text,
  destination_verified boolean not null default false,
  destination_verified_at timestamptz,
  consent_version text,
  consent_at timestamptz,
  status text not null,
  quota_state text,
  last_error_code text,
  create_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  delete_requested_at timestamptz,
  deleted_at timestamptz
);
create index if not exists reddit_email_bindings_user_idx
  on reddit_email_bindings (user_id, status);
create unique index if not exists reddit_email_bindings_fp_uidx
  on reddit_email_bindings (user_id, create_fingerprint)
  where deleted_at is null and create_fingerprint is not null;

create table if not exists reddit_account_readiness (
  id text primary key,
  user_id text not null,
  account_id text not null,
  owner_confirmed text not null default 'unknown',
  identity_status text not null default 'unknown',
  access_status text not null default 'unknown',
  email_status text not null default 'unknown',
  restriction_status text not null default 'unknown',
  app_permission_status text not null default 'unknown',
  community_status text not null default 'unknown',
  session_status text not null default 'unknown',
  reasons_json text not null default '{}',
  last_observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_id)
);

create table if not exists reddit_draft_posts (
  id text primary key,
  user_id text not null,
  account_id text not null,
  version integer not null default 1,
  parent_draft_id text,
  community text not null,
  community_list_version text not null,
  rules_snapshot_ref text,
  rules_retrieved_at timestamptz,
  topic text not null,
  asserted_facts text not null default '',
  title text not null,
  body text not null,
  post_type text not null default 'self',
  flair text,
  model_id text,
  prompt_version text not null,
  generation_id text,
  fit_explanation text,
  validation_status text not null,
  validation_json text not null default '{}',
  approval_status text not null default 'needs_review',
  approved_at timestamptz,
  content_hash text not null,
  usage_json text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reddit_draft_posts_user_idx
  on reddit_draft_posts (user_id, account_id, created_at desc);

create table if not exists reddit_publication_intents (
  id text primary key,
  user_id text not null,
  account_id text not null,
  draft_id text not null,
  draft_version integer not null,
  community text not null,
  content_hash text not null,
  status text not null,
  approval_receipt text,
  expires_at timestamptz,
  provider_receipt_json text,
  reddit_post_id text,
  permalink text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consumed_at timestamptz
);
create unique index if not exists reddit_publication_intents_one_open_uidx
  on reddit_publication_intents (user_id, draft_id)
  where status in ('prepared', 'submitted_unknown');
