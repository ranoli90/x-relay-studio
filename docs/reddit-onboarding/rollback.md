# Rollback

This feature is additive. Existing Reddit dashboard, OAuth, and unrelated platforms keep working when onboarding flags are off.

## Flag rollback (no schema change)

Production defaults:

- `REDDIT_ONBOARDING_ENABLED=false` hides Create vs Connect and restores the previous Setup app → Connect → Health path if any leftover door still uses it. Connected accounts remain.
- `REDDIT_ASSISTED_SIGNUP_ENABLED` off
- `REDDIT_BROWSER_PROVIDER=fake` is rejected for assisted signup in production

Turning `REDDIT_ONBOARDING_ENABLED=false` restores the previous Setup app → Connect → Health path. Connected accounts remain.

## Worker rollback

Stop `src/workers/reddit-onboarding.ts`. Preview already no-ops that worker without `DATABASE_URL`. In-process fake drain only runs when the provider is `fake`.

## Schema rollback (only if 0027/0028 were applied)

Do **not** drop `reddit_accounts` or `reddit_apps`. Optional, after jobs are finished:

```sql
-- Stop new work first via flags, then:
-- drop table if exists reddit_cleanup_tasks;
-- drop table if exists reddit_secret_entries;
-- drop table if exists reddit_onboarding_events;
-- drop table if exists reddit_onboarding_commands;
-- drop table if exists reddit_browser_profiles;
-- drop table if exists reddit_onboarding_jobs;
-- drop table if exists reddit_integration_approvals;
-- New columns on reddit_apps / reddit_accounts / reddit_oauth_tickets are nullable or defaulted and can remain.
```

Backfill 0028 only labels existing accounts `preexisting` / `needs_review`. It does not delete tokens.

## Build rollback

`npm run build` must not run migrations. If a future change reintroduces that, revert `package.json` `build` to the F09 form.
