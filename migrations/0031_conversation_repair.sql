-- Conversation-system repair (PR-01..PR-08).
-- Number 0031 reserved after inventory: main ends at 0027; Reddit #21 uses 0027–0030.
-- Additive. Safe defaults: existing autopilot is held in draft until an operator reviews.

alter table agent_personas
  add column if not exists automation_mode text not null default 'draft';
alter table agent_personas
  add column if not exists emergency_stop boolean not null default false;
alter table agent_personas
  add column if not exists profile_approved boolean not null default false;
alter table agent_personas
  add column if not exists profile_revision integer not null default 1;
alter table agent_personas
  add column if not exists fictional_character boolean not null default true;

-- Existing always-on rows are contained, not re-armed.
update agent_personas
   set automation_mode = 'draft',
       auto_send = false,
       background_run = false
 where automation_mode is distinct from 'approved_auto';

alter table agent_persona_claims
  add column if not exists approved boolean not null default false;
alter table agent_persona_claims
  add column if not exists fictional boolean not null default true;
alter table agent_persona_claims
  add column if not exists status text not null default 'legacy_unapproved';

update agent_persona_claims
   set status = 'legacy_unapproved', approved = false
 where status = 'legacy_unapproved' or approved = false;

alter table agent_threads
  add column if not exists telegram_account_id text;
alter table agent_threads
  add column if not exists account_generation integer not null default 1;
alter table agent_threads
  add column if not exists partner_id text;
alter table agent_threads
  add column if not exists consent_epoch integer not null default 1;
alter table agent_threads
  add column if not exists context_version integer not null default 0;
alter table agent_threads
  add column if not exists opt_out boolean not null default false;
alter table agent_threads
  add column if not exists opt_out_at timestamptz;
alter table agent_threads
  add column if not exists adult_eligibility text not null default 'unknown';
alter table agent_threads
  add column if not exists pending_question text;
alter table agent_threads
  add column if not exists commercial_state text not null default 'none';
alter table agent_threads
  add column if not exists activation_watermark timestamptz;

alter table agent_fans
  add column if not exists preferred_name text;
alter table agent_fans
  add column if not exists telegram_account_id text;
alter table agent_fans
  add column if not exists account_generation integer not null default 1;

alter table agent_messages
  add column if not exists origin text;
alter table agent_messages
  add column if not exists transport_message_id text;
alter table agent_messages
  add column if not exists reply_id text;
alter table agent_messages
  add column if not exists bubble_index integer;
alter table agent_messages
  add column if not exists generation_id text;

alter table agent_offers
  add column if not exists currency text not null default 'USD';
alter table agent_offers
  add column if not exists merchant_id text;
alter table agent_offers
  add column if not exists quote_revision integer not null default 1;
alter table agent_offers
  add column if not exists spoken_reply_id text;
alter table agent_offers
  add column if not exists expires_at timestamptz;
alter table agent_offers
  add column if not exists amount_minor integer;
update agent_offers set amount_minor = price_cents where amount_minor is null;

alter table agent_idempotency
  add column if not exists status text not null default 'claimed';
alter table agent_idempotency
  add column if not exists thread_id text;
alter table agent_idempotency
  add column if not exists result_json text;
alter table agent_idempotency
  add column if not exists attempt_count integer not null default 1;
alter table agent_idempotency
  add column if not exists next_attempt_at timestamptz;
alter table agent_idempotency
  add column if not exists input_fingerprint text;
alter table agent_idempotency
  add column if not exists lease_until timestamptz;

create table if not exists conversation_facts (
  id              text primary key,
  user_id         text not null,
  desk_id         text not null,
  persona_id      text not null,
  conversation_id text not null,
  partner_id      text not null,
  subject_kind    text not null,
  predicate       text not null,
  value           text not null,
  assertion       text not null,
  status          text not null,
  source_event_id text,
  source_voice    text,
  confidence      real not null default 0.5,
  observed_at     timestamptz not null default now(),
  effective_at    timestamptz,
  expires_at      timestamptz,
  supersedes_id   text,
  fictional       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists conversation_facts_thread_idx
  on conversation_facts (conversation_id, observed_at);

create table if not exists conversation_bubbles (
  id                    text primary key,
  user_id               text not null,
  reply_id              text not null,
  thread_id             text not null,
  persona_id            text not null,
  bubble_index          integer not null,
  body                  text not null,
  body_revision         integer not null default 1,
  status                text not null,
  transport_message_id  text,
  acknowledged_at       timestamptz,
  reason                text,
  generation_id         text,
  context_version       integer,
  consent_epoch         integer,
  account_generation    integer,
  created_at            timestamptz not null default now()
);
create unique index if not exists conversation_bubbles_reply_idx
  on conversation_bubbles (reply_id, bubble_index);
create index if not exists conversation_bubbles_thread_idx
  on conversation_bubbles (thread_id, created_at);

create table if not exists conversation_reservations (
  id            text primary key,
  user_id       text not null,
  persona_id    text not null,
  partner_id    text not null,
  offer_id      text,
  kind          text not null,
  status        text not null,
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists conversation_reservations_open_idx
  on conversation_reservations (persona_id, partner_id, kind)
  where status in ('held', 'confirmed');

create table if not exists conversation_followups (
  id              text primary key,
  user_id         text not null,
  thread_id       text not null,
  purpose_key     text not null,
  status          text not null,
  run_at          timestamptz not null,
  context_version integer,
  evidence        text,
  created_at      timestamptz not null default now()
);
create unique index if not exists conversation_followups_purpose_idx
  on conversation_followups (thread_id, purpose_key)
  where status in ('proposed', 'permitted', 'scheduled', 'due');

create table if not exists generation_traces (
  id                      text primary key,
  user_id                 text not null,
  thread_id               text,
  task                    text not null,
  requested_route         text,
  actual_model            text,
  provider_generation_id  text,
  finish_reason           text,
  latency_ms              integer,
  input_tokens            integer,
  output_tokens           integer,
  safe_error              text,
  origin                  text,
  accepted                boolean not null default false,
  created_at              timestamptz not null default now()
);
create index if not exists generation_traces_thread_idx
  on generation_traces (thread_id, created_at desc);

alter table agent_model_calls
  add column if not exists finish_reason text;
alter table agent_model_calls
  add column if not exists provider_generation_id text;
alter table agent_model_calls
  add column if not exists safe_error text;
alter table agent_model_calls
  add column if not exists usage_json text;

alter table telegram_messages
  add column if not exists next_attempt_at timestamptz;
alter table telegram_messages
  add column if not exists ai_attempt_count integer not null default 0;

create index if not exists telegram_messages_retry_idx
  on telegram_messages (user_id, ai_status, next_attempt_at)
  where ai_status in ('queued', 'retry_wait');

alter table telegram_user_sessions
  add column if not exists activation_watermark timestamptz;
alter table telegram_user_sessions
  add column if not exists emergency_stop boolean not null default false;

-- Watching/import is not send authorization. Do not rearm on migrate.
update telegram_user_sessions
   set automation_armed = false
 where coalesce(automation_armed, false) = true
   and coalesce(emergency_stop, false) = false;
