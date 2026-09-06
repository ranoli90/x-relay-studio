-- Autopilot is always on. Gold eval no longer gates send.
-- Additive. Do not edit 0001–0026.

alter table agent_personas
  alter column auto_send set default true;

alter table agent_personas
  alter column background_run set default true;

update agent_personas
   set auto_send = true,
       background_run = true
 where auto_send = false
    or background_run = false;

-- Live Telegram sessions: watch + draft so autopilot can actually run.
update telegram_user_sessions
   set watching = true,
       automation_armed = true,
       updated_at = now()
 where session_enc is not null
   and coalesce(auth_dead, false) = false
   and (watching = false or automation_armed = false);
