-- Fix workspace bootstrap: the RPC must atomically create a tenant and its
-- dependent rows, while preserving the caller identity and restricting execution.
-- SECURITY DEFINER is safe here because auth.uid() is mandatory, no tenant ID is
-- accepted from the caller, values are validated, search_path is empty, and
-- execution is revoked from PUBLIC/anon.
create or replace function public.bootstrap_tenant(
  p_business_name text,
  p_business_type text,
  p_agent_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_slug text;
  v_agent uuid;
  v_plan uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if pg_catalog.length(pg_catalog.btrim(coalesce(p_business_name, ''))) < 2
     or pg_catalog.length(pg_catalog.btrim(p_business_name)) > 120 then
    raise exception 'invalid_business_name';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_business_type, ''))) < 2
     or pg_catalog.length(pg_catalog.btrim(p_business_type)) > 80 then
    raise exception 'invalid_business_type';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_agent_name, ''))) < 2
     or pg_catalog.length(pg_catalog.btrim(p_agent_name)) > 80 then
    raise exception 'invalid_agent_name';
  end if;

  v_slug := pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_business_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := pg_catalog.btrim(v_slug, '-');
  if v_slug = '' then v_slug := 'business'; end if;
  v_slug := pg_catalog.left(v_slug, 70) || '-' ||
    pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.tenants(owner_id, name, slug, business_type, onboarding_step, onboarding_completed)
    values (v_uid, pg_catalog.btrim(p_business_name), v_slug, pg_catalog.btrim(p_business_type), 4, false)
    returning id into v_tenant;

  insert into public.tenant_members(tenant_id, user_id, role)
    values (v_tenant, v_uid, 'owner');

  insert into public.agents(tenant_id, name, status, language, language_mode)
    values (v_tenant, pg_catalog.btrim(p_agent_name), 'draft', 'auto', 'auto')
    returning id into v_agent;

  insert into public.integrations(tenant_id, kind, status, display_name)
    select v_tenant, k, 'not_connected', pg_catalog.initcap(pg_catalog.replace(k, '_', ' '))
    from pg_catalog.unnest(array[
      'website','whatsapp_meta','whatsapp_evolution','shopify','woocommerce',
      'instagram','facebook','email','google_sheets','crm','pos','custom_api'
    ]) as kinds(k);

  select id into v_plan from public.plans where code = 'trial' and active = true limit 1;
  if v_plan is null then raise exception 'trial_plan_missing'; end if;

  insert into public.subscriptions(tenant_id, plan_id, status)
    values (v_tenant, v_plan, 'trial');

  insert into public.audit_logs(tenant_id, user_id, action, entity_type, entity_id, new_values)
    values (v_tenant, v_uid, 'tenant_bootstrap', 'tenant', v_tenant,
      pg_catalog.jsonb_build_object('agent_id', v_agent));

  return v_tenant;
end;
$function$;

revoke all on function public.bootstrap_tenant(text, text, text) from public;
revoke all on function public.bootstrap_tenant(text, text, text) from anon;
grant execute on function public.bootstrap_tenant(text, text, text) to authenticated;
