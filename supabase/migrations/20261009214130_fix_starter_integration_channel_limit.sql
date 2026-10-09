create or replace function public.enforce_resource_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_metric text;
  v_limit bigint;
  v_count bigint;
  v_status text;
begin
  v_metric := case TG_TABLE_NAME
    when 'agents' then 'agents'
    when 'tenant_members' then 'team_members'
    when 'products' then 'products'
    when 'integrations' then 'channels'
    when 'conversations' then 'conversations'
    when 'orders' then 'orders'
    when 'followups' then 'followups'
    else null
  end;

  if v_metric is null then return NEW; end if;

  -- Pre-created "not connected" hub entries are not active channel usage.
  -- Keep table-specific record-field access in a nested branch. The shared
  -- trigger function also runs on tables whose NEW record has no status field.
  if TG_TABLE_NAME = 'integrations' then
    if coalesce(NEW.status, '') not in ('connected', 'connecting', 'pending') then
      return NEW;
    end if;
  end if;

  select sub.status, (pl.limits ->> v_metric)::bigint
    into v_status, v_limit
  from public.subscriptions sub
  join public.plans pl on pl.id = sub.plan_id
  where sub.tenant_id = NEW.tenant_id
  order by sub.created_at desc
  limit 1;

  if v_limit is null then
    select (pl.limits ->> v_metric)::bigint into v_limit
    from public.plans pl
    where pl.code = 'trial' and pl.active = true
    limit 1;
    v_status := 'trial';
  end if;

  if coalesce(v_status, 'trial') in ('expired', 'canceled', 'past_due', 'suspended') then
    raise exception 'plan_inactive';
  end if;
  if v_limit is null or v_limit < 0 then
    raise exception 'usage_limit_not_configured';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.tenant_id::text || ':' || v_metric, 0)
  );

  if TG_TABLE_NAME = 'integrations' then
    if TG_OP = 'UPDATE' then
      select count(*) into v_count
      from public.integrations i
      where i.tenant_id = NEW.tenant_id
        and i.id <> NEW.id
        and i.status in ('connected', 'connecting', 'pending');
    else
      select count(*) into v_count
      from public.integrations i
      where i.tenant_id = NEW.tenant_id
        and i.status in ('connected', 'connecting', 'pending');
    end if;
  else
    execute pg_catalog.format(
      'select count(*) from public.%I where tenant_id = $1',
      TG_TABLE_NAME
    ) into v_count using NEW.tenant_id;
  end if;

  if v_count >= v_limit then
    raise exception 'resource_limit_exceeded';
  end if;

  return NEW;
end
$function$;

drop trigger if exists integrations_resource_limit on public.integrations;
drop trigger if exists integrations_resource_limit_update on public.integrations;
create trigger integrations_resource_limit
  before insert on public.integrations
  for each row execute function public.enforce_resource_limit();
create trigger integrations_resource_limit_update
  before update of status, tenant_id on public.integrations
  for each row execute function public.enforce_resource_limit();

revoke all on function public.enforce_resource_limit() from public, anon, authenticated;
