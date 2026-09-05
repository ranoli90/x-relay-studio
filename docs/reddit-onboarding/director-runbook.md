# Director runbook (internal prototype / export only)

Director is **not** a customer-facing runtime and is **not** assumed to be an embeddable API.

## What Director is for

- Author a bounded email-signup workflow offline.
- Export a reviewed manifest (origins, allowed actions, privacy flags, pin version).
- Hand that pin to the worker as `REDDIT_WORKFLOW_VERSION`.

## What Director is not

- Not required to connect an existing Reddit account.
- Not required for Manual setup or ordinary OAuth.
- Not a generic browser-control console.
- Not allowed to receive passwords, OTPs, cookies, refresh tokens, or raw CDP.

## Export review checklist

1. Signup method is email only. Google/Apple/phone variants must fail closed.
2. Allowed origins are Reddit properties (plus local fixture host).
3. Forbidden: `evaluate`, `cdp`, unrestricted `prompt`, `accept_terms`, `grant_oauth`, `solve_captcha`, `post`, `vote`, `send_message`, `rotate_proxy`, `create_mailbox`.
4. Privacy: `recordSession=false`, `logSession=false`, `captchaSolving=false`, `advancedStealth=false`, `validateCertificates=true`.
5. Max model observations ≤ 8. Sensitive pages skip the model.
6. Fixture outcomes: username rejected → `needs_user`; verification → `needs_user`; unknown page → unsupported; apparent success → owner must still confirm. Never treat a mock as live account creation.

The checked-in export is `docs/reddit-onboarding/director-export/email-signup.v1.md` and `src/lib/reddit/onboarding/workflows/manifest.ts` (`email-signup.v1`).

## Runtime pin

`REDDIT_WORKFLOW_VERSION` must match the exported pin. A mismatch blocks assisted execution; Manual and OAuth still work.
