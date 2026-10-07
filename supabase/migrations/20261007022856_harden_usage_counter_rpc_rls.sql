alter function public.consume_usage(uuid,text,bigint,bigint) security invoker;
drop policy if exists "usage_member_insert" on public.usage_counters;
drop policy if exists "usage_member_update" on public.usage_counters;
create policy "usage_member_insert" on public.usage_counters for insert to authenticated with check (is_tenant_member(tenant_id));
create policy "usage_member_update" on public.usage_counters for update to authenticated using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
