type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/** Arm ingest + auto-send. Never clears emergency stop, takeover, or opt-out. */
export async function applyLiveArmSql(userId: string, sql: Sql): Promise<void> {
  await sql.query(
    `update agent_personas
        set auto_send = true,
            background_run = true,
            processing_permission = true,
            desired_auto_reply = true,
            automation_mode = 'approved_auto'
      where user_id = $1
        and coalesce(emergency_stop, false) = false`,
    [userId],
  );
  await sql.query(
    `update telegram_user_sessions
        set watching = true,
            automation_armed = true,
            updated_at = now()
      where user_id = $1
        and session_enc is not null
        and coalesce(auth_dead, false) = false
        and coalesce(emergency_stop, false) = false`,
    [userId],
  );
}
