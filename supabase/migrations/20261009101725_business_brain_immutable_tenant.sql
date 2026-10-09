-- A knowledge document belongs to exactly one tenant for its entire lifetime.
-- Prevent tenant reassignment even when a user belongs to both the source and target tenants.
create or replace function private.prevent_knowledge_tenant_reassignment()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if old.tenant_id is distinct from new.tenant_id then
    raise exception 'knowledge_document_tenant_immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists knowledge_document_tenant_immutable on public.knowledge_documents;
create trigger knowledge_document_tenant_immutable
before update of tenant_id on public.knowledge_documents
for each row execute function private.prevent_knowledge_tenant_reassignment();
