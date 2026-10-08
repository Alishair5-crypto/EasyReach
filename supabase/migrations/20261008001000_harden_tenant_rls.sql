-- Tenant isolation hardening: move RLS helper functions out of exposed public schema,
-- restrict policies to authenticated users, prevent tenant-member privilege escalation,
-- and make auth lookups init-plan friendly.

create schema if not exists private;

create or replace function private.is_tenant_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant
      and tm.user_id = auth.uid()
  );
$$;

create or replace function private.is_tenant_admin(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant
      and tm.user_id = auth.uid()
      and tm.role in ('owner','admin')
  );
$$;

revoke all on function private.is_tenant_member(uuid) from public;
revoke all on function private.is_tenant_admin(uuid) from public;
grant execute on function private.is_tenant_member(uuid) to authenticated;
grant execute on function private.is_tenant_admin(uuid) to authenticated;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists tenants_member_read on public.tenants;
drop policy if exists tenants_owner_self_read on public.tenants;
drop policy if exists tenants_owner_insert on public.tenants;
drop policy if exists tenants_admin_update on public.tenants;

create policy tenants_member_read on public.tenants
  for select to authenticated
  using ((select private.is_tenant_member(id)));

create policy tenants_owner_insert on public.tenants
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy tenants_admin_update on public.tenants
  for update to authenticated
  using ((select private.is_tenant_admin(id)))
  with check ((select private.is_tenant_admin(id)));

drop policy if exists tenant_members_admin_write on public.tenant_members;
drop policy if exists tenant_members_admin_insert on public.tenant_members;
drop policy if exists tenant_members_admin_update on public.tenant_members;
drop policy if exists tenant_members_admin_delete on public.tenant_members;
drop policy if exists tenant_members_member_read on public.tenant_members;
drop policy if exists tenant_members_owner_bootstrap on public.tenant_members;
drop policy if exists tenant_members_insert on public.tenant_members;

create policy tenant_members_member_read on public.tenant_members
  for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));

create policy tenant_members_insert on public.tenant_members
  for insert to authenticated
  with check (
    (
      (select private.is_tenant_admin(tenant_id))
      and role in ('admin','manager','sales','support','viewer')
    )
    or
    (
      user_id = (select auth.uid())
      and role = 'owner'
      and exists (
        select 1 from public.tenants t
        where t.id = tenant_members.tenant_id
          and t.owner_id = (select auth.uid())
      )
    )
  );

create policy tenant_members_admin_update on public.tenant_members
  for update to authenticated
  using (
    (select private.is_tenant_admin(tenant_id))
    and role <> 'owner'
  )
  with check (
    (select private.is_tenant_admin(tenant_id))
    and role in ('admin','manager','sales','support','viewer')
  );

create policy tenant_members_admin_delete on public.tenant_members
  for delete to authenticated
  using (
    (select private.is_tenant_admin(tenant_id))
    and role <> 'owner'
  );

drop policy if exists agents_member_access on public.agents;
create policy agents_member_access on public.agents for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists ai_action_confirmations_member on public.ai_action_confirmations;
create policy ai_action_confirmations_member on public.ai_action_confirmations for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists ai_usage_member_read on public.ai_usage_events;
create policy ai_usage_member_read on public.ai_usage_events for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

drop policy if exists audit_member_insert on public.audit_logs;
create policy audit_member_insert on public.audit_logs for insert to authenticated
with check (
  (select private.is_tenant_member(tenant_id))
  and actor_id = (select auth.uid())
);

drop policy if exists audit_member_read on public.audit_logs;
create policy audit_member_read on public.audit_logs for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

drop policy if exists conversations_member on public.conversations;
create policy conversations_member on public.conversations for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists customer_identities_member on public.customer_identities;
create policy customer_identities_member on public.customer_identities for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists customers_member on public.customers;
create policy customers_member on public.customers for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists followups_member_access on public.followups;
create policy followups_member_access on public.followups for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists integrations_member_access on public.integrations;
create policy integrations_member_access on public.integrations for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists knowledge_member on public.knowledge_documents;
create policy knowledge_member on public.knowledge_documents for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists leads_member on public.leads;
create policy leads_member on public.leads for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists messages_member on public.messages;
create policy messages_member on public.messages for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists order_action_receipts_member on public.order_action_receipts;
create policy order_action_receipts_member on public.order_action_receipts for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists order_items_member on public.order_items;
create policy order_items_member on public.order_items for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists orders_member on public.orders;
create policy orders_member on public.orders for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists product_variants_member on public.product_variants;
drop policy if exists variants_member on public.product_variants;
create policy variants_member on public.product_variants for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists products_member on public.products;
create policy products_member on public.products for all to authenticated
using ((select private.is_tenant_member(tenant_id)))
with check ((select private.is_tenant_member(tenant_id)));

drop policy if exists subscriptions_admin on public.subscriptions;
drop policy if exists subscriptions_member on public.subscriptions;
drop policy if exists subscriptions_member_read on public.subscriptions;

create policy subscriptions_member_read on public.subscriptions
  for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));

create policy subscriptions_admin_insert on public.subscriptions
  for insert to authenticated
  with check ((select private.is_tenant_admin(tenant_id)));

create policy subscriptions_admin_update on public.subscriptions
  for update to authenticated
  using ((select private.is_tenant_admin(tenant_id)))
  with check ((select private.is_tenant_admin(tenant_id)));

create policy subscriptions_admin_delete on public.subscriptions
  for delete to authenticated
  using ((select private.is_tenant_admin(tenant_id)));

drop policy if exists usage_member on public.usage_counters;
create policy usage_member on public.usage_counters for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

drop policy if exists webhook_events_member_read on public.webhook_events;
create policy webhook_events_member_read on public.webhook_events for select to authenticated
using ((select private.is_tenant_member(tenant_id)));

drop function if exists public.is_tenant_member(uuid);
drop function if exists public.is_tenant_admin(uuid);
