create or replace function public.consume_usage(p_tenant_id uuid,p_metric text,p_quantity bigint,p_limit bigint)
returns table(allowed boolean,quantity bigint)
language plpgsql
set search_path=public,pg_temp
as $function$
declare
 v_period date:=date_trunc('month',now())::date;
 v_qty bigint;
 v_limit bigint;
begin
 if p_quantity is null or p_quantity<=0 then raise exception 'invalid_usage_request'; end if;
 if not exists(select 1 from tenant_members where tenant_id=p_tenant_id and user_id=auth.uid()) then raise exception 'not_authorized'; end if;
 select (pl.limits->>p_metric)::bigint into v_limit
 from subscriptions sub join plans pl on pl.id=sub.plan_id
 where sub.tenant_id=p_tenant_id
 order by sub.created_at desc limit 1;
 if v_limit is null or v_limit<0 then raise exception 'usage_limit_not_configured'; end if;
 insert into usage_counters(tenant_id,period_start,metric,quantity,updated_at)
 values(p_tenant_id,v_period,p_metric,p_quantity,now())
 on conflict(tenant_id,period_start,metric) do update set quantity=usage_counters.quantity+p_quantity,updated_at=now()
 returning usage_counters.quantity into v_qty;
 if v_qty>v_limit then
  update usage_counters set quantity=quantity-p_quantity,updated_at=now()
  where tenant_id=p_tenant_id and period_start=v_period and metric=p_metric returning quantity into v_qty;
  return query select false,v_qty;
 end if;
 return query select true,v_qty;
end
$function$;
