-- Production uniqueness and fact dedup. Additive.
-- Rollback: drop the new indexes; keep processing_permission=false.

-- Dedupe first so unique indexes can apply on existing desks.
delete from agent_threads t
 where exists (
   select 1 from agent_threads t2
    where t2.user_id = t.user_id and t2.fan_id = t.fan_id and t2.id < t.id
 );

delete from agent_fans f
 where f.tg_peer_id is not null
   and exists (
     select 1 from agent_fans f2
      where f2.user_id = f.user_id and f2.tg_peer_id = f.tg_peer_id and f2.id < f.id
   );

delete from memory_facts m
 where m.status = 'active'
   and exists (
     select 1 from memory_facts m2
      where m2.user_id = m.user_id
        and m2.customer_id = m.customer_id
        and m2.predicate = m.predicate
        and m2.value = m.value
        and m2.status = 'active'
        and m2.id < m.id
   );

create unique index if not exists agent_fans_user_peer
  on agent_fans (user_id, tg_peer_id)
  where tg_peer_id is not null;

create unique index if not exists agent_threads_user_fan
  on agent_threads (user_id, fan_id);

create unique index if not exists memory_facts_active_dedup
  on memory_facts (user_id, customer_id, predicate, value)
  where status = 'active';
