create or replace function public.confirm_ai_action(p_tenant_id uuid,p_token_hash text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.ai_action_confirmations%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()) then raise exception 'not_authorized'; end if;
 select * into c from public.ai_action_confirmations where tenant_id=p_tenant_id and token_hash=p_token_hash for update;
 if not found then raise exception 'confirmation_not_found'; end if;
 if c.consumed_at is not null then raise exception 'confirmation_already_used'; end if;
 if c.expires_at<=now() then raise exception 'confirmation_expired'; end if;
 if c.confirmed_at is null then update public.ai_action_confirmations set confirmed_at=now(),confirmed_by=auth.uid() where id=c.id; end if;
 return jsonb_build_object('confirmation_id',c.id,'action_type',c.action_type,'confirmed',true,'expires_at',c.expires_at);
end $$;
revoke all on function public.confirm_ai_action(uuid,text) from public,anon;
grant execute on function public.confirm_ai_action(uuid,text) to authenticated;