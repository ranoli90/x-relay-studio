-- Production uniqueness and fact dedup. Additive.
-- Rollback: drop the new indexes; keep processing_permission=false.

create unique index if not exists agent_fans_user_peer
  on agent_fans (user_id, tg_peer_id)
  where tg_peer_id is not null;

create unique index if not exists agent_threads_user_fan
  on agent_threads (user_id, fan_id);

create unique index if not exists memory_facts_active_dedup
  on memory_facts (user_id, customer_id, predicate, value)
  where status = 'active';
