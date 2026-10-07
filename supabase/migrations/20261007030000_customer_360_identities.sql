create table if not exists public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','website','shopify','woocommerce','instagram','facebook','email','google_sheets','crm','pos','custom_api')),
  external_id text not null,
  display_name text,
  phone text,
  email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel, external_id),
  unique (tenant_id, id)
);
alter table public.customer_identities enable row level security;
drop policy if exists customer_identities_member on public.customer_identities;
create policy customer_identities_member on public.customer_identities
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
create index if not exists customer_identities_customer_idx on public.customer_identities(tenant_id, customer_id);
create index if not exists customer_identities_lookup_idx on public.customer_identities(tenant_id, channel, external_id);
create index if not exists customers_tenant_name_idx on public.customers(tenant_id, name collate "C");
create index if not exists customers_tenant_phone_idx on public.customers(tenant_id, phone);
create index if not exists customers_tenant_email_idx on public.customers(tenant_id, email);
create index if not exists conversations_customer_last_message_idx on public.conversations(tenant_id, customer_id, last_message_at desc);
create index if not exists orders_customer_created_idx on public.orders(tenant_id, customer_id, created_at desc);
create index if not exists leads_customer_created_idx on public.leads(tenant_id, customer_id, created_at desc);
create index if not exists followups_customer_scheduled_idx on public.followups(tenant_id, customer_id, scheduled_for);