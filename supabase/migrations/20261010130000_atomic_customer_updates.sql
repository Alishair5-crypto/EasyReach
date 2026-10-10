-- Make Customer 360 profile changes and their audit events atomic.
-- Validate on a disposable Supabase database before any production rollout.
create or replace function public.update_customer_atomic(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_before public.customers%rowtype;
  v_after public.customers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager', 'sales', 'support')
  ) then
    raise exception 'not_authorized';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or (p_patch - array['name','phone','email','preferred_language','consent','tags','notes']) <> '{}'::jsonb then
    raise exception 'invalid_customer_patch';
  end if;

  if p_patch ? 'name' and jsonb_typeof(p_patch->'name') not in ('string','null') then raise exception 'invalid_name'; end if;
  if p_patch ? 'phone' and jsonb_typeof(p_patch->'phone') not in ('string','null') then raise exception 'invalid_phone'; end if;
  if p_patch ? 'email' and jsonb_typeof(p_patch->'email') not in ('string','null') then raise exception 'invalid_email'; end if;
  if p_patch ? 'preferred_language' and jsonb_typeof(p_patch->'preferred_language') not in ('string','null') then raise exception 'invalid_language'; end if;
  if p_patch ? 'notes' and jsonb_typeof(p_patch->'notes') not in ('string','null') then raise exception 'invalid_notes'; end if;
  if p_patch ? 'tags' and (
    jsonb_typeof(p_patch->'tags') <> 'array'
    or exists (select 1 from jsonb_array_elements(p_patch->'tags') as tag(value) where jsonb_typeof(tag.value) <> 'string')
  ) then raise exception 'invalid_tags'; end if;
  if p_patch ? 'consent' and jsonb_typeof(p_patch->'consent') <> 'object' then raise exception 'invalid_consent'; end if;

  select * into v_before
  from public.customers c
  where c.tenant_id = p_tenant_id and c.id = p_customer_id
  for update;
  if not found then raise exception 'customer_not_found'; end if;

  v_after := jsonb_populate_record(v_before, p_patch);
  v_after.updated_at := now();

  update public.customers c
  set name = v_after.name,
      phone = v_after.phone,
      email = v_after.email,
      preferred_language = v_after.preferred_language,
      consent = v_after.consent,
      tags = v_after.tags,
      notes = v_after.notes,
      updated_at = v_after.updated_at
  where c.tenant_id = p_tenant_id and c.id = p_customer_id
  returning * into v_after;

  insert into public.audit_logs(
    tenant_id, actor_id, action, resource_type, resource_id, old_data, new_data, reason
  ) values (
    p_tenant_id, auth.uid(), 'customer.updated', 'customer', p_customer_id,
    to_jsonb(v_before), to_jsonb(v_after), 'Atomic Customer 360 profile update'
  );

  return jsonb_build_object(
    'id', v_after.id,
    'external_key', v_after.external_key,
    'name', v_after.name,
    'phone', v_after.phone,
    'email', v_after.email,
    'preferred_language', v_after.preferred_language,
    'consent', v_after.consent,
    'tags', v_after.tags,
    'notes', v_after.notes,
    'last_seen_at', v_after.last_seen_at,
    'created_at', v_after.created_at,
    'updated_at', v_after.updated_at
  );
end
$function$;

revoke all on function public.update_customer_atomic(uuid, uuid, jsonb) from public, anon;
grant execute on function public.update_customer_atomic(uuid, uuid, jsonb) to authenticated;

-- Prevent bypassing the audited customer update path through direct PostgREST UPDATE.
revoke update on table public.customers from anon, authenticated;
