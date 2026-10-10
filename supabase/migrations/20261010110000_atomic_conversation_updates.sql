-- Make conversation updates and their audit events one database transaction.
-- This migration is staged for isolated-database validation; do not apply to production
-- until the EasyReach release gates are satisfied.
create or replace function public.update_conversation_atomic(
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_before public.conversations%rowtype;
  v_after public.conversations%rowtype;
  v_assignee uuid;
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
     or (p_patch - array['status', 'priority', 'handoff', 'assigned_to']) <> '{}'::jsonb then
    raise exception 'invalid_conversation_patch';
  end if;

  if p_patch ? 'status' and (
    jsonb_typeof(p_patch->'status') is distinct from 'string'
    or p_patch->>'status' not in ('open', 'pending', 'closed')
  ) then raise exception 'invalid_status'; end if;

  if p_patch ? 'priority' and (
    jsonb_typeof(p_patch->'priority') is distinct from 'string'
    or p_patch->>'priority' not in ('low', 'normal', 'high', 'urgent')
  ) then raise exception 'invalid_priority'; end if;

  if p_patch ? 'handoff' and jsonb_typeof(p_patch->'handoff') is distinct from 'boolean' then
    raise exception 'invalid_handoff';
  end if;

  if p_patch ? 'assigned_to' then
    if jsonb_typeof(p_patch->'assigned_to') = 'null' then
      v_assignee := null;
    elsif jsonb_typeof(p_patch->'assigned_to') = 'string' then
      begin
        v_assignee := (p_patch->>'assigned_to')::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid_assignee';
      end;
      if not exists (
        select 1 from public.tenant_members tm
        where tm.tenant_id = p_tenant_id and tm.user_id = v_assignee
      ) then raise exception 'invalid_assignee'; end if;
    else
      raise exception 'invalid_assignee';
    end if;
  end if;

  select * into v_before
  from public.conversations c
  where c.tenant_id = p_tenant_id and c.id = p_conversation_id
  for update;
  if not found then raise exception 'conversation_not_found'; end if;

  update public.conversations c
  set status = case when p_patch ? 'status' then p_patch->>'status' else c.status end,
      priority = case when p_patch ? 'priority' then p_patch->>'priority' else c.priority end,
      handoff = case when p_patch ? 'handoff' then (p_patch->>'handoff')::boolean else c.handoff end,
      assigned_to = case when p_patch ? 'assigned_to' then v_assignee else c.assigned_to end
  where c.tenant_id = p_tenant_id and c.id = p_conversation_id
  returning * into v_after;

  insert into public.audit_logs(
    tenant_id, actor_id, action, resource_type, resource_id, old_data, new_data, reason
  ) values (
    p_tenant_id, auth.uid(), 'conversation_updated', 'conversation', p_conversation_id,
    to_jsonb(v_before), to_jsonb(v_after), 'Atomic Shared Inbox conversation update'
  );

  return to_jsonb(v_after);
end
$function$;

revoke all on function public.update_conversation_atomic(uuid, uuid, jsonb) from public, anon;
grant execute on function public.update_conversation_atomic(uuid, uuid, jsonb) to authenticated;
