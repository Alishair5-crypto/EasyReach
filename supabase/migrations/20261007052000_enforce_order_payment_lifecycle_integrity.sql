-- Enforce payment verification before an order can enter paid/fulfilled lifecycle states.
-- Direct table access remains restricted; lifecycle mutations are performed by RPCs.

create or replace function public.transition_order_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_new_status text,
  p_idempotency_key text
) returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  r public.orders%rowtype;
  existing jsonb;
  allowed boolean:=false;
begin
  if auth.uid() is null
     or not exists (
       select 1 from public.tenant_members tm
       where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()
     ) then
    raise exception 'not_authorized';
  end if;

  if length(coalesce(p_idempotency_key,''))<8
     or length(p_idempotency_key)>200 then
    raise exception 'invalid_idempotency_key';
  end if;

  if p_new_status not in ('draft','pending','confirmed','paid','fulfilled','canceled','failed') then
    raise exception 'invalid_status';
  end if;

  select result into existing
  from public.order_action_receipts
  where tenant_id=p_tenant_id
    and order_id=p_order_id
    and action_type='status'
    and action_key=p_idempotency_key;

  if existing is not null then return existing; end if;

  select * into r
  from public.orders
  where tenant_id=p_tenant_id and id=p_order_id
  for update;

  if not found then raise exception 'order_not_found'; end if;

  if p_new_status='paid' and r.payment_status<>'paid' then
    raise exception 'payment_not_verified';
  end if;

  if r.status='paid' and p_new_status='fulfilled' and r.payment_status<>'paid' then
    raise exception 'payment_not_verified';
  end if;

  allowed:=case
    when r.status='draft' and p_new_status in ('pending','canceled','failed') then true
    when r.status='pending' and p_new_status in ('confirmed','canceled','failed') then true
    when r.status='confirmed' and p_new_status in ('paid','canceled','failed') then true
    when r.status='paid' and p_new_status in ('fulfilled','canceled','failed') then true
    when r.status='fulfilled' and p_new_status='fulfilled' then true
    when r.status='canceled' and p_new_status='canceled' then true
    when r.status='failed' and p_new_status='failed' then true
    else false
  end;

  if not allowed then raise exception 'invalid_status_transition'; end if;

  update public.orders
  set status=p_new_status,updated_at=now()
  where id=r.id and tenant_id=p_tenant_id;

  insert into public.audit_logs(
    tenant_id,actor_id,action,resource_type,resource_id,old_data,new_data,reason
  ) values (
    p_tenant_id,auth.uid(),'order_status_changed','order',r.id,
    jsonb_build_object('status',r.status),
    jsonb_build_object('status',p_new_status),
    'Verified order lifecycle transition'
  );

  existing:=jsonb_build_object('order_id',r.id,'status',p_new_status);

  insert into public.order_action_receipts(
    tenant_id,order_id,action_key,action_type,result
  ) values (
    p_tenant_id,r.id,p_idempotency_key,'status',existing
  );

  return existing;
exception when unique_violation then
  select result into existing
  from public.order_action_receipts
  where tenant_id=p_tenant_id
    and order_id=p_order_id
    and action_type='status'
    and action_key=p_idempotency_key;
  if existing is not null then return existing; end if;
  raise;
end
$$;

revoke all on table public.order_action_receipts from anon,public;
revoke all on table public.order_action_receipts from authenticated;
grant select on table public.order_action_receipts to authenticated;
