-- Auto-send, named agents, background run, roster + activity floor.
-- Additive. Do not edit 0001–0025.

alter table agent_personas
  add column if not exists background_run boolean not null default false;

alter table agent_threads
  add column if not exists agent_name text;

alter table agent_messages
  add column if not exists agent_name text;

create table if not exists agent_roster (
  id          text primary key,
  user_id     text not null,
  persona_id  text not null references agent_personas (id) on delete cascade,
  name        text not null,
  tone        text not null check (tone in ('sage', 'sand', 'ink', 'clay', 'mist')),
  created_at  timestamptz not null default now()
);
create unique index if not exists agent_roster_user_name_idx
  on agent_roster (user_id, name);
create index if not exists agent_roster_persona_idx
  on agent_roster (persona_id);

create table if not exists agent_activity (
  id          text primary key,
  user_id     text not null,
  persona_id  text,
  thread_id   text,
  agent_name  text,
  kind        text not null check (kind in ('inbound', 'typing', 'sent', 'held', 'handoff', 'killed', 'failed')),
  body        text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_activity_user_idx
  on agent_activity (user_id, created_at desc);
create index if not exists agent_activity_thread_idx
  on agent_activity (thread_id, created_at desc);

create index if not exists agent_personas_background_idx
  on agent_personas (user_id)
  where background_run = true;
