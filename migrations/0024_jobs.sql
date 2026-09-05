-- Jobs: one SLA ticket per paid offer so fulfillment watchdog retries do not duplicate.
delete from agent_tickets a
 using agent_tickets b
 where a.kind = 'sla'
   and b.kind = 'sla'
   and a.offer_id is not null
   and a.offer_id = b.offer_id
   and a.id > b.id;

create unique index if not exists agent_tickets_sla_offer_uidx
  on agent_tickets (offer_id)
  where kind = 'sla' and offer_id is not null;
