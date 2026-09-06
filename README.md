# X Relay Studio

Anonymous desk for X, Telegram, and Reddit — plus an operator OS for Telegram DMs.

A 16-digit number is the only account. No name, no email, no Google, no X login. Connect platforms after the desk exists. The number is a key — if it is lost, the desk is gone.

## What this is

- **Desk** — Mullvad-style 16-digit identity stored in Better Auth as `d{number}@example.com`.
- **Operator** — Telegram-clone rails. Ingest → safety → triage → workflow → plan → write. Thought stream and diary never send. Catalog prices are allowlisted. Payment webhook is truth, not a screenshot.
- **X** — sign in the posting account, assign public sources, sync archives, rewrite with OpenRouter.
- **Telegram** — the user's own `api_id` / `api_hash` from my.telegram.org (Web app), phone login code, optional cloud password. Official Bot API webhooks for helper bots. Queued inbound drains into the brain.
- **Reddit** — official OAuth2 (`authorization_code` + `duration=permanent`), read-only scopes. Sugar $0 threads hit QUALIFY, not free labor.

The LLM is a mouth with tools. We own the OpenRouter route table. `openrouter/auto` is never the brain.

## Operator workflows

`INGEST → SAFETY → TRIAGE → QUALIFY → (PAY) → DAY-ARC → GFE_INVITE → CONTRACT → FULFILL → AFTERCARE`

Conversation automation is **off until an operator turns it on**. After migration `0031_conversation_repair.sql`, existing autopilot rows are held in `draft` with `auto_send=false`. Auto-send requires all of:

- operator Auto-send switch on (`automation_mode = approved_auto`)
- a validated model reply (local templates never auto-send)
- no emergency stop, partner opt-out, takeover, or unknown adult eligibility on restricted commercial workflows
- a live Telegram peer and confirmed transport acknowledgment

Reads, desk seeding, and page loads do not rearm sending. Emergency **Stop** on the floor persists across reloads. Historical Telegram import (messages at or before the account activation watermark) is stored as `imported` and does not trigger replies.

Drafts, operator notes, and unsent approvals are not conversation history. The model sees confirmed inbound plus provider-acknowledged outbound only. Quotes are exact minor units on an approved offer; a screenshot is never payment.

The LLM is a disclosed AI persona with human desk support. It must not invent biography, human identity, proof, scarcity, or a price that is not on the catalog/quote.

## Production requirements

Copy `.env.example` and set at least:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Neon. Production refuses to boot on PGLite. |
| `BETTER_AUTH_SECRET` | Sessions + AES-GCM envelopes for Reddit/Telegram secrets. |
| `BETTER_AUTH_URL` | Public origin. OAuth redirects and OpenRouter referer. |
| `OPENROUTER_API_KEY` | Rewrites + writer. Fail-closed if missing in production rewrite path. |
| `CRON_SECRET` | `Authorization: Bearer` on `/api/cron/studio`. |
| `PAYMENTS_WEBHOOK_SECRET` | Payment rails. Screenshot is never PAID. |

Run migrations as a release step, not during `vite build`:

```
npm run db:migrate
```

## Local preview

```
npm install
cp .env.example .env.local
npm run dev
```

Without `DATABASE_URL`, preview uses in-memory PGLite and applies `migrations/*.sql`. Open a desk, then Operator — seeded Maya threads, catalog, seats, and the inbound simulator.

## Compliance notes

- Reddit tokens and client secrets are encrypted at rest. Origins are allowlisted.
- Telegram webhook secrets are header-only. Photo proxy requires a session.
- Cron takes a Postgres advisory lock so overlapping Vercel invocations cannot double-fire. Cron also drains `ai_status=queued` Telegram messages and fulfillment SLAs (10 min).
- Duplicate migration numbers fail CI (`scripts/check-migration-unique.mjs`).
- Privacy, terms, and a static status page live at `/privacy`, `/terms`, and `/status`.
- Unofficial FXTwitter lookup is off on Vercel unless `FXTWITTER_ENABLED=true`.
- OpenRouter requests set `provider.data_collection = deny`. Diaries do not train a public mix.
- `npm test` covers flags, webhook hashing, desk numbers, Reddit health, Telegram hardening, and gold threads (qualify, GFE, burned, reverse-scam, meetup, injection, crisis, minor).
- `npm run smoke -- https://your-app.vercel.app` hits `/`, legal pages, and `/robots.txt`.

See `SECURITY.md` before putting real traffic on a deployment.
