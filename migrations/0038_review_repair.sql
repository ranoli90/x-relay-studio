-- Review follow-up: one active fact per predicate, duplicate preflight.
-- Rollback: drop memory_facts_one_active_predicate.

-- Keep the oldest active value when a predicate has more than one.
update memory_facts m
   set status = 'superseded'
 where status = 'active'
   and exists (
     select 1 from memory_facts m2
      where m2.user_id = m.user_id
        and m2.customer_id = m.customer_id
        and m2.predicate = m.predicate
        and m2.status = 'active'
        and m2.id < m.id
   );

create unique index if not exists memory_facts_one_active_predicate
  on memory_facts (user_id, customer_id, predicate)
  where status = 'active';
