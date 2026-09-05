-- Conversation brain, diary, catalog, seats, payments, thoughts.
-- Operator desk for Telegram GFE / content. All rows scoped to the desk user.

create table if not exists agent_personas (
  id              text primary key,
  user_id         text not null,
  handle          text not null,
  display_name    text not null,
  bible           text not null,
  timezone        text not null default 'America/Denver',
  quiet_start     integer not null default 23,
  quiet_end       integer not null default 10,
  auto_send       boolean not null default false,
  spend_cap_cents integer not null default 15000,
  created_at      timestamptz not null default now()
);
create unique index if not exists agent_personas_user_idx
  on agent_personas (user_id, handle);

create table if not exists agent_persona_claims (
  id          text primary key,
  user_id     text not null,
  persona_id  text not null references agent_personas (id) on delete cascade,
  kind        text not null,
  claim       text not null,
  start_hour  integer,
  end_hour    integer,
  weekday     integer,
  created_at  timestamptz not null default now()
);
create index if not exists agent_persona_claims_idx
  on agent_persona_claims (persona_id);

create table if not exists agent_catalog (
  id            text primary key,
  user_id       text not null,
  persona_id    text not null references agent_personas (id) on delete cascade,
  sku           text not null,
  title         text not null,
  price_cents   integer not null,
  rail          text not null,
  eligibility   text not null default 'any',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists agent_catalog_sku_idx
  on agent_catalog (persona_id, sku);

create table if not exists agent_seats (
  id            text primary key,
  user_id       text not null,
  persona_id    text not null references agent_personas (id) on delete cascade,
  kind          text not null,
  capacity      integer not null,
  held          integer not null default 0,
  updated_at    timestamptz not null default now()
);
create unique index if not exists agent_seats_kind_idx
  on agent_seats (persona_id, kind);

create table if not exists agent_fans (
  id              text primary key,
  user_id         text not null,
  persona_id      text not null references agent_personas (id) on delete cascade,
  display_name    text not null,
  handle          text,
  source          text not null default 'telegram',
  archetype       text not null default 'new',
  lifetime_cents  integer not null default 0,
  trust           integer not null default 20,
  tg_peer_id      text,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists agent_fans_user_idx
  on agent_fans (user_id, persona_id);

create table if not exists agent_threads (
  id              text primary key,
  user_id         text not null,
  persona_id      text not null,
  fan_id          text not null references agent_fans (id) on delete cascade,
  workflow        text not null default 'W4_QUALIFY',
  state           text not null default 'open',
  takeover        boolean not null default false,
  parked_until    timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unread          integer not null default 0,
  created_at      timestamptz not null default now()
);
create unique index if not exists agent_threads_fan_idx
  on agent_threads (fan_id);

create table if not exists agent_messages (
  id            text primary key,
  user_id       text not null,
  thread_id     text not null references agent_threads (id) on delete cascade,
  role          text not null check (role in ('fan', 'persona', 'system', 'draft')),
  body          text not null,
  workflow      text,
  offer_id      text,
  auto          boolean not null default false,
  status        text not null default 'sent',
  created_at    timestamptz not null default now()
);
create index if not exists agent_messages_thread_idx
  on agent_messages (thread_id, created_at);

create table if not exists agent_diary (
  id          text primary key,
  user_id     text not null,
  persona_id  text not null,
  fan_id      text not null references agent_fans (id) on delete cascade,
  voice       text not null check (voice in ('HIM', 'ME', 'US')),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists agent_diary_fan_idx
  on agent_diary (fan_id, voice, created_at desc);

create table if not exists agent_plans (
  id          text primary key,
  user_id     text not null,
  thread_id   text not null references agent_threads (id) on delete cascade,
  workflow    text not null,
  strategy    text not null,
  tactic      text not null,
  offer_id    text,
  hold        boolean not null default true,
  reason      text not null,
  doors_json  text not null default '[]',
  check_in_h  integer,
  created_at  timestamptz not null default now()
);
create index if not exists agent_plans_thread_idx
  on agent_plans (thread_id, created_at desc);

create table if not exists agent_thoughts (
  id          text primary key,
  user_id     text not null,
  thread_id   text not null references agent_threads (id) on delete cascade,
  kind        text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists agent_thoughts_thread_idx
  on agent_thoughts (thread_id, created_at desc);

create table if not exists agent_offers (
  id            text primary key,
  user_id       text not null,
  persona_id    text not null,
  fan_id        text not null,
  thread_id     text not null,
  sku           text not null,
  price_cents   integer not null,
  status        text not null default 'sent',
  created_at    timestamptz not null default now(),
  paid_at       timestamptz,
  delivered_at  timestamptz
);
create index if not exists agent_offers_fan_idx
  on agent_offers (fan_id, created_at desc);

create table if not exists agent_payments (
  id            text primary key,
  user_id       text not null,
  offer_id      text not null references agent_offers (id) on delete cascade,
  rail          text not null,
  amount_cents  integer not null,
  status        text not null default 'pending',
  external_id   text,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz
);
create unique index if not exists agent_payments_ext_idx
  on agent_payments (rail, external_id)
  where external_id is not null;

create table if not exists agent_tickets (
  id          text primary key,
  user_id     text not null,
  thread_id   text,
  offer_id    text,
  kind        text not null,
  body        text not null,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);
create index if not exists agent_tickets_user_idx
  on agent_tickets (user_id, status, created_at desc);

create table if not exists agent_proof_assets (
  id          text primary key,
  user_id     text not null,
  persona_id  text not null,
  kind        text not null,
  label       text not null,
  body        text not null,
  used_fan_id text,
  live        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists agent_proof_persona_idx
  on agent_proof_assets (persona_id, used_fan_id);

create table if not exists agent_tactics (
  id          text primary key,
  user_id     text not null,
  persona_id  text not null,
  name        text not null,
  workflow    text not null,
  weight      integer not null default 50,
  wins        integer not null default 0,
  losses      integer not null default 0
);
create unique index if not exists agent_tactics_name_idx
  on agent_tactics (persona_id, name);

create table if not exists agent_model_calls (
  id            text primary key,
  user_id       text not null,
  thread_id     text,
  task          text not null,
  model         text not null,
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  latency_ms    integer not null default 0,
  cost_micros   integer not null default 0,
  outcome       text not null default 'ok',
  fallback      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists agent_model_calls_user_idx
  on agent_model_calls (user_id, created_at desc);

create table if not exists agent_idempotency (
  id          text primary key,
  user_id     text not null,
  key         text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists agent_idempotency_key_idx
  on agent_idempotency (user_id, key);

create table if not exists agent_jobs (
  id          text primary key,
  user_id     text not null,
  thread_id   text,
  kind        text not null,
  run_at      timestamptz not null,
  payload     text not null default '{}',
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists agent_jobs_due_idx
  on agent_jobs (user_id, run_at)
  where done_at is null;
