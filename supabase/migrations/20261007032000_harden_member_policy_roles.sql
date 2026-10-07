alter policy agents_member_access on public.agents to authenticated;
alter policy integrations_member_access on public.integrations to authenticated;
alter policy tenant_members_admin_write on public.tenant_members to authenticated;
alter policy tenant_members_member_read on public.tenant_members to authenticated;