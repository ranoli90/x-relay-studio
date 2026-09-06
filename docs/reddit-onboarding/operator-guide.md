# Operator guide — Reddit onboarding

Continuation of `feat/reddit-onboarding` from `e7beb4d`. This is not a live-signup runbook. Assisted signup, remote OAuth, Browserbase, and direct publish stay off until their own authorization.

Safety cleanup can run while new onboarding is disabled. Missing production dependencies fail closed.

## Environment flags

| Flag | Default | Notes |
|---|---|---|
| `REDDIT_ONBOARDING_ENABLED` | local on; **off on every Vercel host** | Hosted preview is not automatically on. `VERCEL` is set there. Set explicit `true` on a named preview if you want the coordinator. |
| `REDDIT_ASSISTED_SIGNUP_ENABLED` | off | Live browser signup. Fake provider cannot run this in production. |
| `REDDIT_REMOTE_OAUTH_ENABLED` | off | Ordinary OAuth stays in the owner’s browser. |
| `REDDIT_DRAFTING_ENABLED` | off | OpenRouter draft composer. Never triggered by signup. |
| `REDDIT_PUBLISH_ENABLED` | off | Direct submit. Copy/open-in-Reddit is the default. |
| `REDDIT_EMAIL_BINDING_ENABLED` | off | Managed alias/inbox. Existing owner inboxes work without this. |
| `REDDIT_ONBOARDING_FIXTURE` | off | Local fixture site only. Forced off when `VERCEL` is set. |

Do not prefix provider, model, or encryption secrets with `VITE_`.

## Resume an incomplete job

1. Open Reddit setup. If a non-terminal job exists for the owner, the coordinator should resume it instead of creating a second active mode.
2. Username and non-secret progress belong on the job row. A blank username is not `user`.
3. If the UI and server disagree after a lost response, retry the **same** idempotency key. A different payload with that key must conflict.
4. Connected accounts stay listed while an add-account job is incomplete.

If resume is stuck: cancel the job (cleanup should release browser resources) and start a new Manual or existing-account flow. Do not create a parallel assisted job.

## Reconnect (OAuth / envelope)

Use reconnect when tokens are missing, decrypt fails closed, or health says reauth.

1. Owner uses **I already have a Reddit account** (or dashboard Add → existing).
2. Ordinary OAuth runs in the owner’s browser. Do not move studio cookies into Browserbase.
3. Reconnecting the same Reddit identity must not consume another slot of the cap of 8.
4. After credential rotation, start a **new** attempt. Do not reuse an authorization code.

### R13 — plaintext or unreadable envelopes

Decrypt is fail-closed. There is no plaintext fallback in production.

1. Dry-run inventory (metadata only, never prints secret values):

   ```
   node scripts/reddit-credential-inventory.mjs
   ```

   Exit 0. JSON counts by envelope kind (`v1`, `v2`, `malformed_envelope`, `non_envelope`, `empty`).
2. `non_envelope` and `malformed_envelope` rows cannot be opened. **Reconnect** those accounts. Do not re-enable `SECRETS_ALLOW_LEGACY_PLAINTEXT` on a deployed host.
3. Valid `v1` envelopes can be wrapped to `v2` with associated data by a future controlled backfill. This script does not write.
4. A missing `SECRETS_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET` is an operator config error, not a reason to treat ciphertext as plaintext.

## Manual handoff

Assisted → Manual must keep the **same** job history and schedule cleanup of the browser session. It must not call create-new while that job is still active (`ACTIVE_JOB_EXISTS`).

Use **Use manual instead** on the progress screen. That calls `handoffOnboardingToManual` on the current job. Username and non-secret progress stay on the same row.

CAPTCHA, terms, final registration, and OAuth consent stay owner actions.

## Retained sign-in deletion

A retention checkbox is a **request**. `retained` is an outcome with an expiry. Do not tell the owner sign-in is saved unless persistence was confirmed.

Deletion path:

1. Owner requests delete. Status becomes `delete_pending`.
2. Worker releases the provider context/session and records deletion.
3. `deleting` / `deleted` profiles must not reopen.
4. Releasing a browser is not disconnecting OAuth and is not deleting the Reddit account.

If the UI still shows “opted in, with a deletion date” without a date, treat retention as unverified. Do not reopen.

## Email binding

Default: the owner’s existing durable address. Managed alias/inbox is optional and flagged (`REDDIT_EMAIL_BINDING_ENABLED`).

- Do not create a mailbox because a wizard loaded.
- Provider/domain choice is explicit. A missing domain is a blocked optional feature.
- Deletion of a managed binding needs confirmation that an alternative recovery address is in place.
- Raw message bodies, OTPs, and codes do not go to OpenRouter, Browserbase observations, analytics, or support logs.
- Mailbox creation is not Reddit email verification.

## Draft composer

Separate from onboarding. `REDDIT_DRAFTING_ENABLED` must be true. Signup completion does not start it.

1. Owner supplies the community allowlist and topic. The model may suggest one allowed community; the owner picks the destination.
2. Missing community rules block automatic publish. They do not create another account.
3. Review/edit before use. An edit or destination change invalidates prior publishing approval.
4. Default handoff: copy / open in Reddit.
5. `REDDIT_PUBLISH_ENABLED` stays false until a separate gate: platform permission, current identity, exact content approval. A model cannot approve publication. Unknown submit outcomes reconcile; do not blindly retry a one-use intent.

## Worker

```
npm run worker:reddit-onboarding
```

No-ops without `DATABASE_URL`. Fake provider plus assisted signup is a boot failure on a deployed host. Stop the process with SIGTERM; a stale PID file is not health. Cleanup tasks should still claim while creation flags are off.

## Rollback

See `rollback.md`. Flag-off first. Do not drop `reddit_accounts` or `reddit_apps`.
