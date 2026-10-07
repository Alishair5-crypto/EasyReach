create extension if not exists pgcrypto;

create table if not exists public.ai_action_confirmations (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 agent_id uuid references public.agents(id) on delete set null, conversation_id uuid references public.conversations(id) on delete set null,
 customer_id uuid references public.customers(id) on delete set null,
 action_type text not null check (action_type in ('create_order','send_product','send_checkout','schedule_followup')),
 payload jsonb not null, token_hash text not null, expires_at timestamptz not null, confirmed_at timestamptz,
 consumed_at timestamptz, confirmed_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 constraint ai_action_confirmations_token_hash_unique unique(token_hash)
);
create index if not exists ai_action_confirmations_tenant_idx on public.ai_action_confirmations(tenant_id,created_at desc);
create index if not exists ai_action_confirmations_active_idx on public.ai_action_confirmations(tenant_id,action_type,expires_at) where consumed_at is null;
alter table public.ai_action_confirmations enable row level security;
drop policy if exists ai_action_confirmations_member on public.ai_action_confirmations;
create policy ai_action_confirmations_member on public.ai_action_confirmations for all to authenticated using(is_tenant_member(tenant_id)) with check(is_tenant_member(tenant_id));
revoke all on table public.ai_action_confirmations from anon,public; grant select,insert,update on table public.ai_action_confirmations to authenticated;

create or replace function public.create_order_confirmation(p_tenant_id uuid,p_agent_id uuid,p_conversation_id uuid,p_customer_id uuid,p_payload jsonb,p_token_hash text,p_expires_at timestamptz) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare confirmation_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()) then raise exception 'not_authorized'; end if;
 if p_token_hash is null or length(p_token_hash)<32 or length(p_token_hash)>128 then raise exception 'invalid_confirmation_token'; end if;
 if p_expires_at<=now() or p_expires_at>now()+interval '15 minutes' then raise exception 'invalid_confirmation_expiry'; end if;
 if p_customer_id is null or not exists(select 1 from public.customers c where c.tenant_id=p_tenant_id and c.id=p_customer_id) then raise exception 'customer_not_found'; end if;
 if p_conversation_id is not null and not exists(select 1 from public.conversations c where c.tenant_id=p_tenant_id and c.id=p_conversation_id) then raise exception 'conversation_not_found'; end if;
 if p_agent_id is not null and not exists(select 1 from public.agents a where a.tenant_id=p_tenant_id and a.id=p_agent_id) then raise exception 'agent_not_found'; end if;
 insert into public.ai_action_confirmations(tenant_id,agent_id,conversation_id,customer_id,action_type,payload,token_hash,expires_at)
 values(p_tenant_id,p_agent_id,p_conversation_id,p_customer_id,'create_order',p_payload,p_token_hash,p_expires_at) returning id into confirmation_id;
 return jsonb_build_object('confirmation_id',confirmation_id,'action_type','create_order','expires_at',p_expires_at);
end $$;
revoke all on function public.create_order_confirmation(uuid,uuid,uuid,uuid,jsonb,text,timestamptz) from public,anon;
grant execute on function public.create_order_confirmation(uuid,uuid,uuid,uuid,jsonb,text,timestamptz) to authenticated;

create or replace function public.execute_confirmed_order_atomic(p_tenant_id uuid,p_token_hash text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.ai_action_confirmations%rowtype; order_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()) then raise exception 'not_authorized'; end if;
 if p_token_hash is null or length(p_token_hash)<32 or length(p_token_hash)>128 then raise exception 'invalid_confirmation_token'; end if;
 select * into c from public.ai_action_confirmations where tenant_id=p_tenant_id and token_hash=p_token_hash for update;
 if not found then raise exception 'confirmation_not_found'; end if;
 if c.action_type<>'create_order' then raise exception 'unsupported_confirmation_action'; end if;
 if c.consumed_at is not null then raise exception 'confirmation_already_used'; end if;
 if c.confirmed_at is null then raise exception 'confirmation_required'; end if;
 if c.expires_at<=now() then raise exception 'confirmation_expired'; end if;
 select public.create_order_atomic(p_tenant_id,c.customer_id,coalesce(c.payload->>'source_channel','dashboard'),coalesce(c.payload->>'currency','PKR'),coalesce(c.payload->'items','[]'::jsonb)) into order_id;
 update public.ai_action_confirmations set consumed_at=now(),confirmed_by=auth.uid() where id=c.id;
 insert into public.audit_logs(tenant_id,actor_id,action,resource_type,resource_id,old_data,new_data,reason) values(p_tenant_id,auth.uid(),'ai.confirmed_order_created','order',order_id,jsonb_build_object('confirmation_id',c.id),jsonb_build_object('order_id',order_id),'Explicit server-issued action confirmation');
 return jsonb_build_object('confirmation_id',c.id,'order_id',order_id,'action_type','create_order','consumed_at',now());
end $$;
revoke all on function public.execute_confirmed_order_atomic(uuid,text) from public,anon;
grant execute on function public.execute_confirmed_order_atomic(uuid,text) to authenticated;