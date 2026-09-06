# Release gate

Do not enable this in production without a separate owner authorization.

## Must stay off in production until authorized

| Gate | Required |
|---|---|
| `REDDIT_ONBOARDING_ENABLED` | explicit true after 0027/0028 on the target DB |
| `REDDIT_ASSISTED_SIGNUP_ENABLED` | remains false unless approval + Browserbase + pin review |
| `REDDIT_BROWSER_PROVIDER` | `browserbase` before any assisted run; fake + assisted is a boot failure |
| `REDDIT_REMOTE_OAUTH_ENABLED` | false |
| Production migrate via `npm run build` | forbidden (F09) |
| Real signup / purchases / provider credits | not authorized by this work |

## Before flipping the coordinator on in production

1. Apply 0027 then 0028 with `npm run db:migrate` on an isolated clone first.
2. Confirm `npm run test:reddit-onboarding` and listed CI files still pass.
3. Confirm Manual + existing-account OAuth still work with Browserbase unset.
4. Confirm disconnect leaves the account disabled while revocation retries.
5. Confirm no `VITE_` provider secrets.

## Never claim

- Mock/fixture result = live account created
- OAuth identity = posting enabled
- Local disable = remote revocation finished
- Form submit = Reddit Data API approval
