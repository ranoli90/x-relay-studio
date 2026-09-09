type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/**
 * Maintain authorized operational state. Never grants processing permission.
 * Revocation, emergency stop, takeover, and opt-out survive ingest, reconnect, and seed.
 */
export async function applyLiveArmSql(userId: string, sql: Sql): Promise<void> {
  await sql.query(
    `update agent_personas
        set desired_auto_reply = true,
            auto_send = case when processing_permission then true else auto_send end,
            background_run = case when processing_permission then true else background_run end,
            automation_mode = case when processing_permission then 'approved_auto' else automation_mode end
      where user_id = $1
        and coalesce(emergency_stop, false) = false`,
    [userId],
  );
  await sql.query(
    `update telegram_user_sessions
        set watching = true,
            automation_armed = case
              when exists (
                select 1 from agent_personas p
                 where p.user_id = telegram_user_sessions.user_id
                   and p.processing_permission
              ) then true
              else automation_armed
            end,
            updated_at = now()
      where user_id = $1
        and session_enc is not null
        and coalesce(auth_dead, false) = false
        and coalesce(emergency_stop, false) = false`,
    [userId],
  );
}
