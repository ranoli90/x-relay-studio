-- Reddit onboarding: additive tables and nullable columns.
-- No live approvals, no constraint that would drop existing accounts.

alter table reddit_apps
  add column if not exists credential_version integer not null default 1,
  add column if not exists approval_id text;

alter table reddit_accounts
  add column if not exists connection_state text not null default 'verified',
  add column if not exists connected_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists disconnected_at timestamptz,
  add column if not exists creation_provenance text not null default 'preexisting',
  add column if not exists browser_profile_id text,
  add column if not exists disabled_at timestamptz,
  add column if not exists cleanup_pending boolean not null default false,
  add column if not exists envelope_version text not null default 'v1';

alter table reddit_oauth_tickets
  add column if not exists job_id text,
  add column if not exists session_hash text,
  add column if not exists expected_username text,
  add column if not exists expected_reddit_id text,
  add column if not exists credential_version integer,
  add column if not exists transport text not null default 'local',
  add column if not exists correlation_id text,
  add column if not exists processing_state text not null default 'open',
  add column if not exists processed_result_json text,
  add column if not exists state_hash text,
  add column if not exists ticket_hash text,
  add column if not exists app_credential_version integer;

create table if not exists reddit_integration_approvals (
  id text primary key,
  user_id text not null,
  app_user_id text not null,
  use_case_version text not null,
  status text not null,
  allowed_capabilities_json text not null default '[]',
  decision_at timestamptz,
  reviewer text,
  evidence_ref text,
  expires_at timestamptz,
  use_case_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, use_case_version)
);
create index if not exists reddit_integration_approvals_user_idx
  on reddit_integration_approvals (user_id);

create table if not exists reddit_onboarding_jobs (
  id text primary key,
  user_id text not null,
  predecessor_job_id text,
  mode text not null,
  intent text not null,
  status text not null,
  step text not null,
  connection_state text not null default 'not_started',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  last_activity_at timestamptz not null default now(),
  wait_reason text,
  wait_deadline_at timestamptz,
  creation_outcome text not null default 'not_started',
  expected_username text,
  verified_reddit_id text,
  verified_username text,
  identity_evidence_kind text,
  identity_verified_at timestamptz,
  account_id text,
  browser_profile_id text,
  provider_session_id text,
  session_generation integer not null default 0,
  provider_expires_at timestamptz,
  control_owner text not null default 'none',
  assistance_consent_version text,
  assistance_consent_at timestamptz,
  retain_context boolean not null default false,
  retain_password boolean not null default false,
  consent_receipt_id text,
  workflow_version text,
  app_credential_version integer,
  use_case_version text,
  environment_id text,
  submit_intent_id text,
  submit_started_at timestamptz,
  submit_result_at timestamptz,
  cancel_requested_at timestamptz,
  error_code text,
  error_summary text,
  lease_owner text,
  lease_generation integer not null default 0,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0,
  next_action_at timestamptz,
  reserved_browser_seconds integer not null default 0,
  consumed_browser_seconds integer not null default 0,
  model_call_count integer not null default 0,
  budget_version integer not null default 1,
  allocation_intent_id text,
  masked_email text,
  cleanup_summary text
);
create index if not exists reddit_onboarding_jobs_user_idx
  on reddit_onboarding_jobs (user_id, updated_at desc);
create unique index if not exists reddit_onboarding_jobs_one_active_uidx
  on reddit_onboarding_jobs (user_id)
  where finished_at is null;

create table if not exists reddit_browser_profiles (
  id text primary key,
  user_id text not null,
  account_id text,
  origin_job_id text not null,
  provider text not null,
  provider_project_id text,
  provider_context_id text,
  environment_id text,
  region text,
  status text not null,
  generation integer not null default 1,
  retention_consent_at timestamptz,
  expires_at timestamptz,
  last_used_at timestamptz,
  last_identity_verified_at timestamptz,
  last_verified_reddit_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delete_requested_at timestamptz,
  deleted_at timestamptz
);
create index if not exists reddit_browser_profiles_user_idx
  on reddit_browser_profiles (user_id);
create unique index if not exists reddit_browser_profiles_context_uidx
  on reddit_browser_profiles (provider, provider_project_id, provider_context_id)
  where provider_context_id is not null and deleted_at is null;

create table if not exists reddit_onboarding_commands (
  id text primary key,
  user_id text not null,
  job_id text not null,
  kind text not null,
  idempotency_key_hash text not null,
  request_fingerprint text not null,
  expected_job_version integer not null,
  payload_json text not null default '{}',
  status text not null,
  attempt integer not null default 0,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_generation integer not null default 0,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  side_effect_status text,
  side_effect_started_at timestamptz,
  side_effect_result_at timestamptz
);
create unique index if not exists reddit_onboarding_commands_idem_uidx
  on reddit_onboarding_commands (user_id, job_id, idempotency_key_hash);
create index if not exists reddit_onboarding_commands_claim_idx
  on reddit_onboarding_commands (status, available_at);

create table if not exists reddit_onboarding_events (
  id text primary key,
  user_id text not null,
  job_id text not null,
  sequence integer not null,
  event_type text not null,
  actor_kind text not null,
  actor_id text,
  occurred_at timestamptz not null default now(),
  job_version integer not null,
  workflow_version text,
  safe_details_json text not null default '{}'
);
create unique index if not exists reddit_onboarding_events_seq_uidx
  on reddit_onboarding_events (job_id, sequence);
create index if not exists reddit_onboarding_events_job_idx
  on reddit_onboarding_events (job_id, sequence);

create table if not exists reddit_secret_entries (
  id text primary key,
  user_id text not null,
  purpose text not null,
  job_id text,
  account_id text,
  ciphertext text not null,
  envelope_version text not null,
  key_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  consent_event_id text,
  deleted_at timestamptz
);
create index if not exists reddit_secret_entries_user_idx
  on reddit_secret_entries (user_id, purpose);

create table if not exists reddit_cleanup_tasks (
  id text primary key,
  user_id text not null,
  job_id text,
  account_id text,
  kind text not null,
  target_reference text not null,
  encrypted_revocation_material text,
  status text not null,
  attempt integer not null default 0,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  last_error_code text,
  generation integer not null default 1,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists reddit_cleanup_tasks_target_uidx
  on reddit_cleanup_tasks (user_id, kind, target_reference, generation);
create index if not exists reddit_cleanup_tasks_claim_idx
  on reddit_cleanup_tasks (status, available_at);
