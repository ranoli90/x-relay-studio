# X Relay desk billing — what you still have to do

Code lives on `feat/plisio-only-checkout` (off `feat/desk-credits`). CryptoBot is gone. Checkout is Plisio on the website: pick pack → pick coin → temp address + QR → webhook credits the desk.

A screenshot is never paid.

---

## 1. Plisio account (no ID on the standard plan)

1. Sign up at https://plisio.net with email + password. Do not upload an ID unless they later force a higher plan.
2. Open **API → API settings**. Copy the **SECRET_KEY**.
3. Create / select the shop that will receive desk thread payments.
4. Turn on **White Label payment processing**. If this is off, Plisio only returns a hosted invoice URL and our page cannot show the deposit address + QR.
5. Set **Status URL** to:

   `https://x-relay-studio-puce.vercel.app/api/payments/plisio?json=true`

   Use your real production origin if it is different. The `?json=true` query is required so callbacks arrive as JSON.
6. Allow these coins on the shop: `USDT_TRX`, `USDT`, `USDT_BSC`, `USDC`, `BTC`, `ETH`, `LTC`, `TRX`, `TON`, `SOL`, `DOGE`.
7. Fund / attach the wallets you want withdrawals to go to. Standard plan pays you in crypto, not USD.

## 2. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production + Preview). Then redeploy.

### Required for thread credits to mint

| Name | Example | What it does |
|---|---|---|
| `PLISIO_SECRET` | `your_plisio_secret_key` | Signs invoices and verifies webhooks. Same value as Plisio SECRET_KEY. |
| `BETTER_AUTH_URL` | `https://x-relay-studio-puce.vercel.app` | Public origin. Used to build the Plisio callback URL. No trailing slash. |
| `DATABASE_URL` | Neon pooled URL | Desk invoices / credit lots live here. Run migration `0020_desk_credits.sql` and `0021_plisio_only.sql`. |
| `BETTER_AUTH_SECRET` | 32+ random bytes | Sessions. Already required. |

### Required for the fan → operator catalog rail (separate ledger)

| Name | What it does |
|---|---|
| `PAYMENTS_WEBHOOK_SECRET` | Bearer secret for `/api/payments/webhook`. Fan catalog only. Does **not** mint desk threads. Do not reuse `CRON_SECRET`. |

### Optional — first-payment $5 off (Telegram + Discord)

| Name | What it does |
|---|---|
| `FOLLOW_TELEGRAM_URL` | Public channel / join link shown on the buy sheet. |
| `FOLLOW_TELEGRAM_CHAT_ID` | Channel or group id for `getChatMember`. |
| `TELEGRAM_BOT_TOKEN` | Bot that is admin of that channel. |
| `FOLLOW_DISCORD_URL` | Invite shown on the buy sheet. |
| `FOLLOW_DISCORD_GUILD_ID` | Guild snowflake they must be in. |
| `DISCORD_BOT_TOKEN` | Bot in that guild. |

### Already required by the studio (not billing-specific)

`OPENROUTER_API_KEY`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, Telegram/Reddit OAuth extras as you already use them.

### Do not set

- `CRYPTOBOT_TOKEN` / `CRYPTOBOT_API_TOKEN` — removed.
- `VITE_AUTH_ENABLED=false` in production.
- Any client-side price or “mark paid” flag.

## 3. Database

On Neon (production):

```bash
npm run db:migrate
```

That applies `migrations/0020_desk_credits.sql` and `migrations/0021_plisio_only.sql`.

Confirm tables exist: `desk_billing`, `desk_credit_lots`, `desk_invoices`, `desk_webhook_events`, `desk_follows`, and `agent_threads.billed_at`.

## 4. First live test

1. Sign in as a desk user on the production origin.
2. Open Buy threads.
3. Buy the **Starter** pack ($29) with **USDT TRC-20**.
4. Send the exact amount shown (not a screenshot).
5. Wait for Plisio `completed` callback.
6. Confirm `desk_invoices.status = paid`, a `desk_credit_lots` row, and the thread meter increases.
7. Send a second identical webhook — credits must **not** increase (replay).
8. Underpay on purpose once — invoice must go `underpay`, no lot minted.

## 5. Still unfinished in code (do not skip)

- [ ] Follow $5 off: `checkFollows` exists but `createThreadInvoice` still trusts a client `followsVerified` flag. Re-check membership server-side at invoice create and bind `desk_follows.external_id` uniquely.
- [ ] Burn hook: first billable AI write on a thread must call the credit burn rules. Killed / parked / takeover / aftercare / failed model / human-only must not burn.
- [ ] Mount the buy sheet on the Telegram desk top bar (“N threads left”).
- [ ] Harden `/api/payments/webhook` — drop `CRON_SECRET` fallback, compare offer price server-side, keep it off the desk ledger.
- [ ] White-label must be on or the sheet falls back to Plisio’s hosted invoice URL.

## 6. What you do not do

- Do not accept cards.
- Do not use OxaPay (US merchants banned).
- Do not treat a screenshot, “I paid”, or a pending/unconfirmed tx as paid.
- Do not mix fan catalog money with desk thread credits.
