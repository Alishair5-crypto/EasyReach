create or replace function public.execute_confirmed_order_atomic(
  p_tenant_id uuid,
  p_token_hash text
) returns jsonb
language plpgsql
set search_path to public, pg_temp
as $function$
declare
  c public.ai_action_confirmations%rowtype;
  v_order uuid;
  v_key text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members
    where tenant_id=p_tenant_id and user_id=auth.uid()
  ) then raise exception 'not_authorized'; end if;

  if p_token_hash is null or length(p_token_hash)<32 or length(p_token_hash)>128
    then raise exception 'invalid_confirmation_token'; end if;

  select * into c from public.ai_action_confirmations
  where tenant_id=p_tenant_id and token_hash=p_token_hash for update;

  if not found then raise exception 'confirmation_not_found'; end if;
  if c.action_type<>'create_order' then raise exception 'unsupported_confirmation_action'; end if;
  if c.consumed_at is not null then raise exception 'confirmation_already_used'; end if;
  if c.confirmed_at is null then raise exception 'confirmation_required'; end if;
  if c.expires_at <= now() then raise exception 'confirmation_expired'; end if;

  v_key := 'ai-confirmation:' || c.id::text;

  v_order := public.create_order_atomic(
    p_tenant_id,c.customer_id,
    coalesce(c.payload->>'source_channel','dashboard'),
    coalesce(c.payload->>'currency','PKR'),
    coalesce(c.payload->'items','[]'::jsonb),
    v_key
  );

  update public.ai_action_confirmations
  set consumed_at=now(),confirmed_by=auth.uid()
  where id=c.id;

  insert into public.order_action_receipts(tenant_id,order_id,action_key,action_type,result)
  values(p_tenant_id,v_order,v_key,'create_order',
         jsonb_build_object('confirmation_id',c.id,'confirmed_by',auth.uid()))
  on conflict do nothing;

  insert into public.audit_logs(
    tenant_id,actor_id,action,resource_type,resource_id,old_data,new_data,reason
  ) values (
    p_tenant_id,auth.uid(),'ai.confirmed_order_created','order',v_order,
    jsonb_build_object('confirmation_id',c.id),
    jsonb_build_object('order_id',v_order),
    'Explicit server-issued action confirmation'
  );

  return jsonb_build_object(
    'confirmation_id',c.id,'order_id',v_order,
    'action_type','create_order','consumed_at',now()
  );
end
$function$;

drop function if exists public.create_order_atomic(uuid,uuid,text,text,jsonb);