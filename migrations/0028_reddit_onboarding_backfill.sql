-- Conservative backfill. Existing connected accounts are preexisting, not
-- created by assisted signup. Missing approval evidence stays needs_review.

update reddit_accounts
set
  connection_state = case
    when disabled_at is not null or disconnected_at is not null then 'disabled'
    when onboarded_at is not null then 'verified'
    else 'pending'
  end,
  connected_at = coalesce(connected_at, created_at),
  verified_at = coalesce(verified_at, onboarded_at),
  creation_provenance = coalesce(nullif(creation_provenance, ''), 'preexisting')
where true;

insert into reddit_integration_approvals (
  id, user_id, app_user_id, use_case_version, status,
  allowed_capabilities_json, use_case_hash
)
select
  'ria_' || substr(md5(user_id || ':data-api-v1'), 1, 24),
  user_id,
  user_id,
  'data-api-v1',
  'needs_review',
  '[]',
  'data-api-v1'
from reddit_apps
on conflict (user_id, use_case_version) do nothing;
