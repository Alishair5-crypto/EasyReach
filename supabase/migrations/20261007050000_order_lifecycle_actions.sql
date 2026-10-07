-- EasyReach order lifecycle actions
-- Applied to production Supabase as order_lifecycle_actions.
-- Keep this migration idempotent if replayed against an environment with the objects already present.

create table if not exists public.order_action_receipts (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 action_key text not null,
 action_type text not null check (action_type in ('status','payment')),
 result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique (tenant_id, order_id, action_type, action_key)
);
alter table public.order_action_receipts enable row level security;
drop policy if exists order_action_receipts_member on public.order_action_receipts;
create policy order_action_receipts_member on public.order_action_receipts for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

create or replace function public.transition_order_atomic(p_tenant_id uuid,p_order_id uuid,p_new_status text,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.orders%rowtype; existing jsonb; allowed boolean:=false;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()) then raise exception 'not_authorized'; end if;
 if length(coalesce(p_idempotency_key,''))<8 or length(p_idempotency_key)>200 then raise exception 'invalid_idempotency_key'; end if;
 if p_new_status not in ('draft','pending','confirmed','paid','fulfilled','canceled','failed') then raise exception 'invalid_status'; end if;
 select result into existing from public.order_action_receipts where tenant_id=p_tenant_id and order_id=p_order_id and action_type='status' and action_key=p_idempotency_key;
 if existing is not null then return existing; end if;
 select * into r from public.orders where tenant_id=p_tenant_id and id=p_order_id for update;
 if not found then raise exception 'order_not_found'; end if;
 allowed:=case when r.status='draft' and p_new_status in ('pending','canceled','failed') then true when r.status='pending' and p_new_status in ('confirmed','canceled','failed') then true when r.status='confirmed' and p_new_status in ('paid','canceled','failed') then true when r.status='paid' and p_new_status in ('fulfilled','canceled','failed') then true when r.status='fulfilled' and p_new_status='fulfilled' then true when r.status='canceled' and p_new_status='canceled' then true when r.status='failed' and p_new_status='failed' then true else false end;
 if not allowed then raise exception 'invalid_status_transition'; end if;
 update public.orders set status=p_new_status,updated_at=now() where id=r.id and tenant_id=p_tenant_id;
 insert into public.audit_logs(tenant_id,actor_id,action,resource_type,resource_id,old_data,new_data,reason) values(p_tenant_id,auth.uid(),'order_status_changed','order',r.id,jsonb_build_object('status',r.status),jsonb_build_object('status',p_new_status),'Verified order lifecycle transition');
 existing:=jsonb_build_object('order_id',r.id,'status',p_new_status);
 insert into public.order_action_receipts(tenant_id,order_id,action_key,action_type,result) values(p_tenant_id,r.id,p_idempotency_key,'status',existing);
 return existing;
exception when unique_violation then select result into existing from public.order_action_receipts where tenant_id=p_tenant_id and order_id=p_order_id and action_type='status' and action_key=p_idempotency_key; if existing is not null then return existing; end if; raise;
end $$;
revoke execute on function public.transition_order_atomic(uuid,uuid,text,text) from public,anon;
grant execute on function public.transition_order_atomic(uuid,uuid,text,text) to authenticated;

create or replace function public.set_order_payment_atomic(p_tenant_id uuid,p_order_id uuid,p_payment_status text,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.orders%rowtype; existing jsonb; allowed boolean:=false;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()) then raise exception 'not_authorized'; end if;
 if length(coalesce(p_idempotency_key,''))<8 or length(p_idempotency_key)>200 then raise exception 'invalid_idempotency_key'; end if;
 if p_payment_status not in ('unpaid','pending','paid','failed','refunded') then raise exception 'invalid_payment_status'; end if;
 select result into existing from public.order_action_receipts where tenant_id=p_tenant_id and order_id=p_order_id and action_type='payment' and action_key=p_idempotency_key;
 if existing is not null then return existing; end if;
 select * into r from public.orders where tenant_id=p_tenant_id and id=p_order_id for update;
 if not found then raise exception 'order_not_found'; end if;
 allowed:=case when r.payment_status='unpaid' and p_payment_status in ('pending','paid','failed') then true when r.payment_status='pending' and p_payment_status in ('paid','failed','unpaid') then true when r.payment_status='paid' and p_payment_status='refunded' then true when r.payment_status='failed' and p_payment_status in ('pending','unpaid') then true when r.payment_status='refunded' and p_payment_status='refunded' then true else false end;
 if not allowed then raise exception 'invalid_payment_transition'; end if;
 update public.orders set payment_status=p_payment_status,updated_at=now() where id=r.id and tenant_id=p_tenant_id;
 insert into public.audit_logs(tenant_id,actor_id,action,resource_type,resource_id,old_data,new_data,reason) values(p_tenant_id,auth.uid(),'order_payment_changed','order',r.id,jsonb_build_object('payment_status',r.payment_status),jsonb_build_object('payment_status',p_payment_status),'Payment state changed; no payment success fabricated');
 existing:=jsonb_build_object('order_id',r.id,'payment_status',p_payment_status);
 insert into public.order_action_receipts(tenant_id,order_id,action_key,action_type,result) values(p_tenant_id,r.id,p_idempotency_key,'payment',existing);
 return existing;
exception when unique_violation then select result into existing from public.order_action_receipts where tenant_id=p_tenant_id and order_id=p_order_id and action_type='payment' and action_key=p_idempotency_key; if existing is not null then return existing; end if; raise;
end $$;
revoke execute on function public.set_order_payment_atomic(uuid,uuid,text,text) from public,anon;
grant execute on function public.set_order_payment_atomic(uuid,uuid,text,text) to authenticated;