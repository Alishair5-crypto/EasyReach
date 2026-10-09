-- Security regression hardening: prevent direct table writes from bypassing
-- order lifecycle/confirmation RPCs. This migration is intentionally staged on
-- test/security-regression-suite and must be verified on a non-production DB
-- before any production application.

-- Only audited RPCs may mutate orders and confirmation state.
-- The live schema has a non-null payload_hash column; the original checked-in
-- migration omitted it and the original create RPC failed to populate it. Bring
-- clean installs and existing databases to the same schema before replacing RPCs.
create extension if not exists pgcrypto;
alter table public.ai_action_confirmations add column if not exists payload_hash text;
update public.ai_action_confirmations
set payload_hash = encode(public.digest(payload::text, 'sha256'), 'hex')
where payload_hash is null;
alter table public.ai_action_confirmations alter column payload_hash set not null;

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
create or replace function public.create_order_atomic(
  p_tenant_id uuid, p_customer_id uuid, p_source_channel text, p_currency text,
  p_items jsonb, p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_order uuid;
  v_item jsonb;
  v_product uuid;
  v_variant uuid;
  v_qty numeric;
  v_unit numeric;
  v_total numeric := 0;
  v_name text;
  v_avail boolean;
  v_inv numeric;
  v_variant_inv numeric;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = auth.uid()
      and role in ('owner', 'admin', 'manager', 'sales')
  ) then raise exception 'not_authorized'; end if;

  if not exists (
    select 1 from public.subscriptions sub
    join public.plans pl on pl.id = sub.plan_id
    where sub.tenant_id = p_tenant_id and sub.status in ('active', 'trial')
      and sub.starts_at <= now() and (sub.ends_at is null or sub.ends_at > now())
      and coalesce((pl.features->>'orders')::boolean, false) = true
  ) then raise exception 'plan_inactive'; end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8
     or length(trim(p_idempotency_key)) > 200 then
    raise exception 'invalid_idempotency_key';
  end if;

  select id into v_order from public.orders
  where tenant_id = p_tenant_id and creation_idempotency_key = trim(p_idempotency_key)
  limit 1;
  if v_order is not null then return v_order; end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers where tenant_id = p_tenant_id and id = p_customer_id
  ) then raise exception 'customer_not_found'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_items';
  end if;

  v_order := gen_random_uuid();
  insert into public.orders(
    id, tenant_id, customer_id, status, currency, subtotal, discount, total,
    payment_status, source_channel, metadata, creation_idempotency_key
  ) values (
    v_order, p_tenant_id, p_customer_id, 'pending',
    coalesce(nullif(p_currency, ''), 'PKR'), 0, 0, 0, 'unpaid',
    nullif(p_source_channel, ''), '{}'::jsonb, trim(p_idempotency_key)
  );

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product := nullif(v_item->>'product_id', '')::uuid;
    v_variant := nullif(v_item->>'variant_id', '')::uuid;
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    if v_qty <= 0 or v_qty > 10000 or v_qty <> trunc(v_qty) then raise exception 'invalid_quantity'; end if;

    if v_variant is not null then
      select coalesce(pv.sale_price, pv.price), pv.availability, pv.inventory_quantity,
             pv.product_id, p.name
      into v_unit, v_avail, v_variant_inv, v_product, v_name
      from public.product_variants pv
      join public.products p on p.id = pv.product_id and p.tenant_id = pv.tenant_id
      where pv.tenant_id = p_tenant_id and pv.id = v_variant
      for update;
      if v_unit is null then raise exception 'variant_price_unavailable'; end if;
      if v_avail is false or (v_variant_inv is not null and v_variant_inv < v_qty) then
        raise exception 'insufficient_inventory';
      end if;
      update public.product_variants
      set inventory_quantity = case when inventory_quantity is null then null else inventory_quantity - v_qty end
      where tenant_id = p_tenant_id and id = v_variant;
    elsif v_product is not null then
      select coalesce(sale_price, price), availability, inventory_quantity, name
      into v_unit, v_avail, v_inv, v_name
      from public.products
      where tenant_id = p_tenant_id and id = v_product
      for update;
      if v_unit is null then raise exception 'product_price_unavailable'; end if;
      if v_avail is false or (v_inv is not null and v_inv < v_qty) then
        raise exception 'insufficient_inventory';
      end if;
      update public.products
      set inventory_quantity = case when inventory_quantity is null then null else inventory_quantity - v_qty end
      where tenant_id = p_tenant_id and id = v_product;
    else
      raise exception 'product_required';
    end if;

    v_total := v_total + (v_unit * v_qty);
    insert into public.order_items(tenant_id, order_id, product_id, variant_id, quantity, unit_price, total, metadata)
    values (p_tenant_id, v_order, v_product, v_variant, v_qty, v_unit, v_unit * v_qty,
      jsonb_build_object('product_name', v_name));
  end loop;

  update public.orders set subtotal = v_total, total = v_total
  where id = v_order and tenant_id = p_tenant_id;

  insert into public.audit_logs(tenant_id, actor_id, action, resource_type, resource_id, old_data, new_data, reason)
  values (p_tenant_id, auth.uid(), 'order_created', 'order', v_order, null,
    jsonb_build_object('order_id', v_order, 'total', v_total,
      'currency', coalesce(nullif(p_currency, ''), 'PKR'), 'status', 'pending'),
    'Atomic order creation with server-verified catalog and inventory');

  return v_order;
exception
  when unique_violation then
    select id into v_order from public.orders
    where tenant_id = p_tenant_id and creation_idempotency_key = trim(p_idempotency_key)
    limit 1;
    if v_order is not null then return v_order; end if;
    raise;
  when invalid_text_representation then
    raise exception 'invalid_item_id';
end
$function$;

create or replace function public.execute_confirmed_order_atomic(p_tenant_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  c public.ai_action_confirmations%rowtype;
  v_order uuid;
  v_key text;
  v_hash text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = auth.uid()
      and role in ('owner', 'admin', 'manager', 'sales')
  ) then raise exception 'not_authorized'; end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'invalid_confirmation_token';
  end if;

  select * into c from public.ai_action_confirmations
  where tenant_id = p_tenant_id and token_hash = p_token_hash for update;
  if not found then raise exception 'confirmation_not_found'; end if;
  if c.action_type <> 'create_order' then raise exception 'unsupported_confirmation_action'; end if;
  if c.consumed_at is not null then raise exception 'confirmation_already_used'; end if;
  if c.confirmed_at is null then raise exception 'confirmation_required'; end if;
  if c.expires_at <= now() then raise exception 'confirmation_expired'; end if;

  v_hash := encode(public.digest(c.payload::text, 'sha256'), 'hex');
  if v_hash <> c.payload_hash then raise exception 'confirmation_integrity_failure'; end if;
  v_key := 'ai-confirmation:' || c.id::text;
  v_order := public.create_order_atomic(
    p_tenant_id, c.customer_id,
    coalesce(c.payload->>'source_channel', 'dashboard'),
    coalesce(c.payload->>'currency', 'PKR'),
    coalesce(c.payload->'items', '[]'::jsonb), v_key
  );

  update public.ai_action_confirmations
  set consumed_at = now(), confirmed_by = auth.uid()
  where id = c.id;
  insert into public.order_action_receipts(tenant_id, order_id, action_key, action_type, result)
  values (p_tenant_id, v_order, v_key, 'create_order',
    jsonb_build_object('confirmation_id', c.id, 'confirmed_by', auth.uid()))
  on conflict do nothing;
  insert into public.audit_logs(tenant_id, actor_id, action, resource_type, resource_id, old_data, new_data, reason)
  values (p_tenant_id, auth.uid(), 'ai.confirmed_order_created', 'order', v_order,
    jsonb_build_object('confirmation_id', c.id, 'payload_hash', c.payload_hash),
    jsonb_build_object('order_id', v_order), 'Explicit server-issued action confirmation');
  return jsonb_build_object('confirmation_id', c.id, 'order_id', v_order,
    'action_type', 'create_order', 'consumed_at', now());
end
$function$;

-- Disable the legacy five-argument overload created by the initial migration.
revoke all on function public.create_order_atomic(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

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
    tenant_id, agent_id, conversation_id, customer_id, action_type, payload,
    payload_hash, token_hash, expires_at
  ) values (
    p_tenant_id, p_agent_id, p_conversation_id, p_customer_id, 'create_order',
    p_payload, encode(public.digest(p_payload::text, 'sha256'), 'hex'), p_token_hash, p_expires_at
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
