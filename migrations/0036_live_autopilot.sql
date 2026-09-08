-- Live operator default: every desk is armed for ingest + auto-send.
-- Safety that stays off-limits: emergency stop, takeover, customer opt-out,
-- unpublished catalog, destination/currency mismatch, dead sessions.
-- Rollback: set processing_permission=false, auto_send=false,
-- desired_auto_reply=false, automation_mode='draft', background_run=false,
-- watching=false, automation_armed=false.

alter table agent_personas
  alter column auto_send set default true;
alter table agent_personas
  alter column background_run set default true;
alter table agent_personas
  alter column processing_permission set default true;
alter table agent_personas
  alter column desired_auto_reply set default true;
alter table agent_personas
  alter column automation_mode set default 'approved_auto';

update agent_personas
   set auto_send = true,
       background_run = true,
       processing_permission = true,
       desired_auto_reply = true,
       automation_mode = 'approved_auto',
       permission_revision = permission_revision + 1
 where coalesce(emergency_stop, false) = false;

alter table telegram_user_sessions
  alter column watching set default true;
alter table telegram_user_sessions
  alter column automation_armed set default true;

update telegram_user_sessions
   set watching = true,
       automation_armed = true,
       updated_at = now()
 where session_enc is not null
   and coalesce(auth_dead, false) = false
   and coalesce(emergency_stop, false) = false;
