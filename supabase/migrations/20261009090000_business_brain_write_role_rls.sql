-- Restrict direct database writes to authorized Business Brain editors.
-- Workspace membership remains sufficient for reading tenant-owned documents.
create or replace function private.is_tenant_knowledge_editor(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin', 'manager')
  );
$function$;

revoke all on function private.is_tenant_knowledge_editor(uuid) from public;
grant execute on function private.is_tenant_knowledge_editor(uuid) to authenticated;

drop policy if exists knowledge_member on public.knowledge_documents;
drop policy if exists knowledge_member_read on public.knowledge_documents;
drop policy if exists knowledge_editor_insert on public.knowledge_documents;
drop policy if exists knowledge_editor_update on public.knowledge_documents;

create policy knowledge_member_read
on public.knowledge_documents
for select
to authenticated
using (private.is_tenant_member(tenant_id));

create policy knowledge_editor_insert
on public.knowledge_documents
for insert
to authenticated
with check (private.is_tenant_knowledge_editor(tenant_id));

create policy knowledge_editor_update
on public.knowledge_documents
for update
to authenticated
using (private.is_tenant_knowledge_editor(tenant_id))
with check (private.is_tenant_knowledge_editor(tenant_id));

-- Direct DELETE is intentionally not granted by policy. Archive records instead.
