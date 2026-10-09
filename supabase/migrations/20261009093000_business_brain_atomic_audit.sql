-- Keep Business Brain document changes and audit evidence in one database transaction.
-- This trigger intentionally runs as the invoking database role so the audit_logs RLS policy still applies.
create or replace function private.audit_knowledge_document_change()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_action text;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_action := 'knowledge.created';
    v_reason := 'Business Brain document created';
    insert into public.audit_logs (
      tenant_id, actor_id, action, resource_type, resource_id, old_data, new_data, reason
    ) values (
      new.tenant_id, auth.uid(), v_action, 'knowledge_document', new.id, null, to_jsonb(new), v_reason
    );
    return new;
  end if;

  if old.verification_status is distinct from new.verification_status
     and new.verification_status = 'verified' then
    v_action := 'knowledge.verified';
    v_reason := 'Business Brain document verified';
  elsif old.verification_status is distinct from new.verification_status
     and new.verification_status = 'rejected' then
    v_action := 'knowledge.rejected';
    v_reason := 'Business Brain document rejected';
  else
    v_action := 'knowledge.updated';
    v_reason := 'Business Brain document updated';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, resource_type, resource_id, old_data, new_data, reason
  ) values (
    new.tenant_id, auth.uid(), v_action, 'knowledge_document', new.id, to_jsonb(old), to_jsonb(new), v_reason
  );
  return new;
end;
$function$;

drop trigger if exists knowledge_document_audit_after_write on public.knowledge_documents;
create trigger knowledge_document_audit_after_write
after insert or update on public.knowledge_documents
for each row execute function private.audit_knowledge_document_change();
