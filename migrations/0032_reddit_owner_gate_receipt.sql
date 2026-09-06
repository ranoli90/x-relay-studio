-- One receipt per desk: the owner completed Reddit's remaining clicks once.
-- Later isolated accounts skip those taps. Live Reddit still presents them.

create table if not exists reddit_owner_gate_receipts (
  user_id text primary key,
  source text not null,
  completed_at timestamptz not null default now()
);
