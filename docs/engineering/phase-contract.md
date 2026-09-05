# Auto-send + live floor contract

User asked to turn auto-send on, keep it running after the tab closes, name the AI, and ship a live agents dashboard. This **overrides** the earlier “human-only / no auto send” line. It does **not** restore `/desk` and does **not** auto-post on X.

## Frozen

- `migrations/0001_*.sql` … `0025_*.sql` — additive only via `0026_auto_send.sql`
- `src/routes/desk.tsx` — redirect to `/telegram/app` forever
- `src/lib/flags.ts` `xAutoPostEnabled()` stays **false**
- No live Plisio charges. No customer charges. Isolated fixtures only (`XRELAY_ALLOW_SIMULATOR=isolated-fixture`)
- Auth ON. Scope every mutation by verified `userId`

## Consent stack (do not collapse)

| Switch | Meaning |
|---|---|
| `watching` | Pull/store chats. **Not** AI consent. |
| `automation_armed` | Consent to draft / run the model on stored inbound. |
| `agent_personas.auto_send` | Consent to send auto-eligible drafts without a human tap. Requires gold eval. |
| `agent_personas.background_run` | Keep watching + drain + jobs running when the browser is gone. |

Quiet hours, takeover, kill, handoff, ALWAYS_DRAFT workflows, writer drops, and gold failure **block send**. Drafts may still be written.

## Auto-eligible workflows

Auto only when `autonomyFor(workflow, true) === "auto"`:

- Auto: `W5_DAY_ARC`, `W10_AFTERCARE`, `W11_REACTIVATE`, `W16_QUEUE`
- Always draft: `W6_CLOSE_NOW`, `W7_GFE`, `W8_OFFER`, `W12_OBJECTION`, `W13_PROOF`, `W15_HANDOFF`, `W2_SAFETY`, `W4_QUALIFY`, `W14_MEDIA_IN`

`decideAutoSend` in `src/lib/agent/auto.ts` is the single decision. `brain.server.ts` must **not** hardcode `const auto = false`.

## Telegram dispatch

- Human path stays `telegramSendFn` (operator typed it).
- Agent path is `agentSendToPeer` in `src/lib/telegram/agent-send.server.ts` using send-intents + MTProto lease. Never label Telegram `sent` before provider ack.
- Preview / unlinked / no `tg_peer_id`: commit locally on the desk (persona/sent) and skip MTProto.
- Live MTProto only when session is live, not preview, not service peer, not `auth_dead`.
- Ingest: `humanOnly: false` when a model actually ran; `ai_status` becomes `outbound` if auto-committed else `held`.

## Schema (`migrations/0026_auto_send.sql`)

```
agent_personas.background_run boolean not null default false
agent_threads.agent_name text
agent_messages.agent_name text

agent_roster (id, user_id, persona_id, name, tone, created_at)
  unique (user_id, name)

agent_activity (id, user_id, persona_id, thread_id, agent_name, kind, body, created_at)
  kind in ('inbound','typing','sent','held','handoff','killed','failed')
```

`tone` is a token key (`sage|sand|ink|clay| mist`), never a hex.

## Names

`src/lib/agent/names.ts`: deterministic pick from a first-name pool keyed by `userId` / `threadId`. New personas get a random display name (not hardcoded Maya). Existing Maya rows stay. Roster is 3 named agents per desk; threads pin `agent_name`.

## Background

`src/lib/agent/loop.server.ts` + cron `/api/cron/studio` + `startup.sh` worker:

For users with `background_run`:

1. `syncWatch` if watching and session live
2. `drainQueuedTelegram` if `automation_armed`
3. `tickAgentJobs`

Dev server in-process interval is allowed. Production relies on the existing every-minute cron. Tab close must not stop background_run users.

## File ownership (exclusive — do not cross)

| Agent | Owns |
|---|---|
| auto-send-core | `src/lib/agent/auto.ts` (new), `auto.test.ts` (new), `names.ts` (new), `activity.server.ts` (new), `dispatch.server.ts` (new), `brain.server.ts`, `ingest-telegram.server.ts`, `seed.server.ts`, `types.ts`, `fns.ts`, `migrations/0026_auto_send.sql` |
| telegram-worker | `src/lib/telegram/agent-send.server.ts` (new), `src/lib/telegram/background.server.ts` (new), `src/lib/agent/loop.server.ts` (new), `src/lib/telegram/watch.server.ts`, `src/lib/telegram/fns.ts`, `src/lib/telegram/types.ts`, `src/lib/telegram/session.server.ts` (only if a watch field is required — prefer persona.background_run), `src/routes/api/cron/studio.ts`, `scripts/agent-worker.mjs` (new), `startup.sh` |
| writer | `src/lib/agent/write.ts`, `write.test.ts`, `gateway.server.ts`, `safety.ts` |
| floor-ui | `src/routes/agents.tsx` (new), `src/components/agents/**` (new), `src/components/studio/platform-chooser.tsx`, `src/components/telegram/settings.tsx`, `src/components/telegram/chat-list.tsx`, `src/components/telegram/conversation.tsx`, `src/components/telegram/replica-shell.tsx`, `src/lib/telegram/store.ts`, `src/styles.css` (additive tokens/motion only), `src/components/desk/desk-shell.tsx` (may rewrite in place **but do not mount it at `/desk`**) |

Do **not** edit `package.json` (parent will). Do not restore `/desk`. Do not touch billing, Plisio, X auto-post, or frozen migrations.

## Types to add (core)

```
DeskSnapshot.persona.backgroundRun: boolean
DeskSnapshot.persona.agentName: string  // display_name
DeskSnapshot.roster: { name: string; tone: string; live: boolean; threadCount: number }[]
DeskSnapshot.activity: { id, agentName, kind, body, threadId, createdAt }[]
OperatorThread.agentName: string | null
OperatorMessage.agentName: string | null
```

`loadDesk` / `loadThread` / `setAutoSend` stay. Add `setBackgroundRun({ on })`. Floor polls `loadDesk` every 3s.

## UI product

- Route `/agents` is the live floor. Hero is the named agent, not “Desk operator”.
- Roster of named AIs with live status (idle / typing / sent / held).
- Active threads sort by latest inbound **or** outbound and animate to the top.
- Conversations are full: bubbles, time, agent name on outbound, typing, draft vs sent, takeover, approve/drop remaining drafts.
- Settings (Telegram): Draft replies, Auto-send, Keep running when I leave — honest copy.
- Home chooser: Agents floor card + Telegram copy that auto-send lives on the floor / settings.

## Writer

Richer local lines (memory, clock, last turn — not one-liner stubs). Gateway: skip LLM on handoff/kill/safety/drop-hold plans. Pass `WriteCaps` into `validateDraft` for remote text. Prefer `grok-4.5` via `XAI_API_KEY` when present; never invent prices/rails/proof. Cap tokens. If LLM fails validation, return local **without** relabeling the model id.
