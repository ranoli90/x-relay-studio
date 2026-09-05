# Workflow manifest — email-signup.v1

Pinned in `src/lib/reddit/onboarding/workflows/manifest.ts`.

| Field | Value |
|---|---|
| id | `email-signup` |
| version | `email-signup.v1` |
| sourceCommit | `beeab5c7ca76ccac3cfa25eabf371f573561519d` |
| signupMethod | email |
| supported variants | `fixture-email-v1` |
| locales tested | `en-US` (fixture only) |
| allowed origins | `https://www.reddit.com`, `https://reddit.com`, `https://old.reddit.com`, local fixture |
| allowed actions | navigate, fill, click, wait, observe, read_identity |
| max steps | 12 |
| max model observations | 8 |
| Stagehand model | `STAGEHAND_MODEL` or `unconfigured` (assisted stays off) |

## Planned steps (bounded)

1. Navigate to `https://www.reddit.com/register/`
2. Fill username (labeled username only)
3. Fill email (labeled email only)
4. Wait / observe — never submit terms, never grant OAuth, never solve CAPTCHA

Password, OTP, and verification codes stay with the owner. They are not queued, logged, or sent to a model.

## Fixture classifications

| Observation | Result |
|---|---|
| username rejected | `needs_user` / `USERNAME_REJECTED` |
| verify / checkpoint | `needs_user` / owner verifies |
| unknown variant, Google, Apple | `UNSUPPORTED_PAGE_VARIANT` |
| title `TEST signup fixture` | owner must verify; not live success |

Live Reddit HTML is not claimed as a supported variant in this pin.
