-- Security regression hardening: prevent direct table writes from bypassing
-- order lifecycle/confirmation RPCs. This migration is intentionally staged on
-- test/security-regression-suite and must be verified on a non-production DB
-- before any production application.

-- Only audited RPCs may mutate orders and confirmation state.
revoke all privileges on table public.orders from anon, authenticated;
revoke all privileges on table public.order_items from anon, authenticated;
revoke all privileges on table public.ai_action_confirmations from anon, authenticated;
revoke all privileges on table public.integration_secrets from anon, authenticated;
revoke all privileges on table public.order_action_receipts from anon, authenticated;
revoke all privileges on table public.webhook_events from anon, authenticated;
revoke all privileges on table public.audit_logs from anon;
grant select on table public.orders, public.order_items, public.ai_action_confirmations, public.order_action_receipts, public.webhook_events to authenticated;
grant select, insert on table public.audit_logs to authenticated;

-- Remove write access to audit history even though the existing RLS policy
-- already lacks UPDATE/DELETE policies. Application audit inserts remain allowed.
revoke update, delete, truncate, references, trigger on table public.audit_logs from authenticated;
revoke all privileges on table public.integration_secrets from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.orders, public.order_items, public.ai_action_confirmations, public.order_action_receipts, public.webhook_events from anon, authenticated;

-- Keep the service-only secret table inaccessible through the public Data API.
revoke all privileges on table public.integration_secrets from anon, authenticated;

-- Every privileged mutation function must validate the caller itself because
-- SECURITY DEFINER bypasses table RLS. Keep a fixed, controlled search path.
alter function public.create_order_atomic(uuid, uuid, text, text, jsonb, text) security definer;
alter function public.create_order_atomic(uuid, uuid, text, text, jsonb, text) set search_path = public, pg_temp;
alter function public.execute_confirmed_order_atomic(uuid, text) security definer;
alter function public.execute_confirmed_order_atomic(uuid, text) set search_path = public, pg_temp;

create or replace function public.transition_order_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_new_status text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  r public.orders%rowtype;
  existing jsonb;
  allowed boolean := false;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager', 'sales')
  ) then
    raise exception 'not_authorized';
  end if;

  if length(coalesce(p_idempotency_key, '')) < 8 or length(p_idempotency_key) > 200 then
    raise exception 'invalid_idempotency_key';
  end if;
  if p_new_status not in ('draft', 'pending', 'confirmed', 'paid', 'fulfilled', 'canceled', 'failed') then
    raise exception 'invalid_status';
  end if;

  select result into existing
  from public.order_action_receipts
  where tenant_id = p_tenant_id and order_id = p_order_id
    and action_type = 'status' and action_key = p_idempotency_key;
  if existing is not null then return existing; end if;

  select * into r from public.orders
  where tenant_id = p_tenant_id and id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if p_new_status = 'paid' and r.payment_status <> 'paid' then
    raise exception 'payment_not_verified';
  end if;
  if r.status = 'paid' and p_new_status = 'fulfilled' and r.payment_status <> 'paid' then
    raise exception 'payment_not_verified';
  end if;

  allowed := case
    when r.status = 'draft' and p_new_status in ('pending', 'canceled', 'failed') then true
    when r.status = 'pending' and p_new_status in ('confirmed', 'canceled', 'failed') then true
    when r.status = 'confirmed' and p_new_status in ('paid', 'canceled', 'failed') then true
    when r.status = 'paid' and p_new_status in ('fulfilled', 'canceled', 'failed') then true
    when r.status = 'fulfilled' and p_new_status = 'fulfilled' then true
    when r.status = 'canceled' and p_new_status = 'canceled' then true
    when r.status = 'failed' and p_new_status = 'failed' then true
    else false
  end;
  if not allowed then raise exception 'invalid_status_transition'; end if;

  update public.orders set status = p_new_status, updated_at = now()
  where id = r.id and tenant_id = p_tenant_id;

  insert into public.audit_logs(tenant_id, actor_id, action, resource_type, resource_id, old_data, new_data, reason)
  values (p_tenant_id, auth.uid(), 'order_status_changed', 'order', r.id,
    jsonb_build_object('status', r.status), jsonb_build_object('status', p_new_status),
    'Verified order lifecycle transition');

  existing := jsonb_build_object('order_id', r.id, 'status', p_new_status);
  insert into public.order_action_receipts(tenant_id, order_id, action_key, action_type, result)
  values (p_tenant_id, r.id, p_idempotency_key, 'status', existing);
  return existing;
exception when unique_violation then
  select result into existing from public.order_action_receipts
  where tenant_id = p_tenant_id and order_id = p_order_id
    and action_type = 'status' and action_key = p_idempotency_key;
  if existing is not null then return existing; end if;
  raise;
end
$function$;

create or replace function public.set_order_payment_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_status text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  r public.orders%rowtype;
  existing jsonb;
  allowed boolean := false;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'not_authorized';
  end if;
  if length(coalesce(p_idempotency_key, '')) < 8 or length(p_idempotency_key) > 200 then
    raise exception 'invalid_idempotency_key';
  end if;
  if p_payment_status not in ('unpaid', 'pending', 'paid', 'failed', 'refunded') then
    raise exception 'invalid_payment_status';
  end if;

  select result into existing from public.order_action_receipts
  where tenant_id = p_tenant_id and order_id = p_order_id
    and action_type = 'payment' and action_key = p_idempotency_key;
  if existing is not null then return existing; end if;

  select * into r from public.orders
  where tenant_id = p_tenant_id and id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  allowed := case
    when r.payment_status = 'unpaid' and p_payment_status in ('pending', 'paid', 'failed') then true
    when r.payment_status = 'pending' and p_payment_status in ('paid', 'failed', 'unpaid') then true
    when r.payment_status = 'paid' and p_payment_status = 'refunded' then true
    when r.payment_status = 'failed' and p_payment_status in ('pending', 'unpaid') then true
    when r.payment_status = 'refunded' and p_payment_status = 'refunded' then true
    else false
  end;
  if not allowed then raise exception 'invalid_payment_transition'; end if;

  update public.orders set payment_status = p_payment_status, updated_at = now()
  where id = r.id and tenant_id = p_tenant_id;
  insert into public.audit_logs(tenant_id, actor_id, action, resource_type, resource_id, old_data, new_data, reason)
  values (p_tenant_id, auth.uid(), 'order_payment_changed', 'order', r.id,
    jsonb_build_object('payment_status', r.payment_status),
    jsonb_build_object('payment_status', p_payment_status),
    'Payment state changed by an authorized operator; external payment verification remains separate');

  existing := jsonb_build_object('order_id', r.id, 'payment_status', p_payment_status);
  insert into public.order_action_receipts(tenant_id, order_id, action_key, action_type, result)
  values (p_tenant_id, r.id, p_idempotency_key, 'payment', existing);
  return existing;
exception when unique_violation then
  select result into existing from public.order_action_receipts
  where tenant_id = p_tenant_id and order_id = p_order_id
    and action_type = 'payment' and action_key = p_idempotency_key;
  if existing is not null then return existing; end if;
  raise;
end
$function$;

-- Confirmation lifecycle is callable only by sales-capable workspace roles.
create or replace function public.create_order_confirmation(
  p_tenant_id uuid, p_agent_id uuid, p_conversation_id uuid, p_customer_id uuid,
  p_payload jsonb, p_token_hash text, p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare confirmation_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager', 'sales')
  ) then raise exception 'not_authorized'; end if;
  if p_token_hash is null or length(p_token_hash) < 32 or length(p_token_hash) > 128 then
    raise exception 'invalid_confirmation_token';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then
    raise exception 'invalid_confirmation_expiry';
  end if;
  if p_customer_id is null or not exists (
    select 1 from public.customers c where c.tenant_id = p_tenant_id and c.id = p_customer_id
  ) then raise exception 'customer_not_found'; end if;
  if p_conversation_id is not null and not exists (
    select 1 from public.conversations c where c.tenant_id = p_tenant_id and c.id = p_conversation_id
  ) then raise exception 'conversation_not_found'; end if;
  if p_agent_id is not null and not exists (
    select 1 from public.agents a where a.tenant_id = p_tenant_id and a.id = p_agent_id
  ) then raise exception 'agent_not_found'; end if;

  insert into public.ai_action_confirmations(
    tenant_id, agent_id, conversation_id, customer_id, action_type, payload, token_hash, expires_at
  ) values (
    p_tenant_id, p_agent_id, p_conversation_id, p_customer_id, 'create_order', p_payload, p_token_hash, p_expires_at
  ) returning id into confirmation_id;

  return jsonb_build_object('confirmation_id', confirmation_id, 'action_type', 'create_order', 'expires_at', p_expires_at);
end
$function$;

create or replace function public.confirm_ai_action(p_tenant_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare c public.ai_action_confirmations%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager', 'sales')
  ) then raise exception 'not_authorized'; end if;
  select * into c from public.ai_action_confirmations
  where tenant_id = p_tenant_id and token_hash = p_token_hash for update;
  if not found then raise exception 'confirmation_not_found'; end if;
  if c.consumed_at is not null then raise exception 'confirmation_already_used'; end if;
  if c.expires_at <= now() then raise exception 'confirmation_expired'; end if;
  if c.confirmed_at is null then
    update public.ai_action_confirmations set confirmed_at = now(), confirmed_by = auth.uid() where id = c.id;
  end if;
  return jsonb_build_object('confirmation_id', c.id, 'action_type', c.action_type, 'confirmed', true, 'expires_at', c.expires_at);
end
$function$;

-- Remove accidental PUBLIC/anon execute grants; only authenticated operators may
-- invoke these RPCs. Each function independently checks membership and role.
revoke all on function public.create_order_atomic(uuid, uuid, text, text, jsonb, text) from public, anon;
revoke all on function public.transition_order_atomic(uuid, uuid, text, text) from public, anon;
revoke all on function public.set_order_payment_atomic(uuid, uuid, text, text) from public, anon;
revoke all on function public.create_order_confirmation(uuid, uuid, uuid, uuid, jsonb, text, timestamptz) from public, anon;
revoke all on function public.confirm_ai_action(uuid, text) from public, anon;
revoke all on function public.execute_confirmed_order_atomic(uuid, text) from public, anon;
grant execute on function public.create_order_atomic(uuid, uuid, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.transition_order_atomic(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.set_order_payment_atomic(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.create_order_confirmation(uuid, uuid, uuid, uuid, jsonb, text, timestamptz) to authenticated, service_role;
grant execute on function public.confirm_ai_action(uuid, text) to authenticated, service_role;
grant execute on function public.execute_confirmed_order_atomic(uuid, text) to authenticated, service_role;
