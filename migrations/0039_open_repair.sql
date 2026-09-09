-- Remaining follow-up repairs: quote identity, media bytes, eligibility evidence,
-- send-part keys, and coalesced ingress. Additive.

alter table agent_offers
  add column if not exists quote_id text;

alter table send_attempts
  add column if not exists reply_part_id text;

create index if not exists send_attempts_part_idx
  on send_attempts (user_id, conversation_id, reply_part_id, created_at desc);

delete from send_attempts a
 where a.reply_part_id is not null
   and exists (
     select 1 from send_attempts b
      where b.user_id = a.user_id
        and b.conversation_id = a.conversation_id
        and b.reply_part_id = a.reply_part_id
        and b.id < a.id
   );

create unique index if not exists send_attempts_part_unique
  on send_attempts (user_id, conversation_id, reply_part_id)
  where reply_part_id is not null;

create table if not exists media_blobs (
  storage_key text primary key,
  user_id text not null,
  mime text not null,
  byte_size integer not null,
  body bytea not null,
  created_at timestamptz not null default now()
);

create table if not exists eligibility_records (
  id text primary key,
  user_id text not null,
  conversation_id text not null,
  status text not null,
  evidence text not null,
  recorded_at timestamptz not null default now()
);

create index if not exists eligibility_records_conv_idx
  on eligibility_records (user_id, conversation_id, recorded_at desc);

alter table telegram_messages
  add column if not exists coalesced_into text;

-- Session generation is authoritative. Stamp threads from the live session.
update agent_threads t
   set account_generation = s.account_generation
  from telegram_user_sessions s
 where t.user_id = s.user_id
   and s.account_generation is not null
   and t.account_generation is distinct from s.account_generation;
