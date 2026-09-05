-- Backfill: new sessions already default watching=false (0019).
-- Existing not-yet-onboarded desks should not scrape like a userbot.
update telegram_user_sessions
   set watching = false
 where onboarded_at is null
   and watching = true
   and coalesce(auth_dead, false) = false;

create index if not exists telegram_user_sessions_flood_idx
  on telegram_user_sessions (flood_until)
  where flood_until is not null;
