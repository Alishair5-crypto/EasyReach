alter table public.messages add column if not exists read_at timestamptz;
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at desc);
create index if not exists conversations_tenant_inbox_idx on public.conversations(tenant_id,last_message_at desc,status,priority,assigned_to);

create or replace function public.validate_conversation_assignment()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=new.tenant_id and tm.user_id=new.assigned_to
  ) then
    raise exception 'invalid_assignee';
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_assignment_guard on public.conversations;
create trigger conversations_assignment_guard
before insert or update of assigned_to on public.conversations
for each row execute function public.validate_conversation_assignment();
revoke execute on function public.validate_conversation_assignment() from public,anon,authenticated;

create or replace function public.touch_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.conversations
     set last_message_at=new.created_at
   where id=new.conversation_id and tenant_id=new.tenant_id;
  return new;
end;
$$;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation_from_message();
revoke execute on function public.touch_conversation_from_message() from public,anon,authenticated;
